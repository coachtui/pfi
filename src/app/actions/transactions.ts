"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import {
  createTransactionSchema, overrideTransactionSchema,
  type MutationResult, type OverrideFormValues, type TransactionFormValues,
} from "@/lib/validation/transactions";

export async function createTransaction(values: TransactionFormValues): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = createTransactionSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: account, error: acctErr } = await supabase
    .from("financial_accounts")
    .select("id, provider, archived_at")
    .eq("id", v.accountId)
    .maybeSingle();
  if (acctErr) return { error: acctErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider !== "manual") {
    return { error: "Transactions can only be added to manual accounts" };
  }
  if (account.archived_at) return { error: "This account is archived" };

  const { error: insertErr } = await supabase.from("transactions").insert({
    account_id: v.accountId, user_id: user.id, posted_date: v.postedDate,
    amount: v.amount, direction: v.direction, description: v.description,
    category: v.category ?? null, notes: v.notes || null,
  });
  if (insertErr) return { error: insertErr.message };

  return finishWithRebuild(supabase);
}

export async function deleteTransaction(id: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(id).success) return { error: "Invalid transaction" };

  const { data: txn, error: fetchErr } = await supabase
    .from("transactions")
    .select("id, financial_accounts!inner(provider)")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!txn) return { error: "Transaction not found" };
  const provider = (txn.financial_accounts as unknown as { provider: string }).provider;
  if (provider !== "manual") {
    return { error: "Imported transactions can't be deleted — recategorize them instead" };
  }

  const { error: delErr } = await supabase.from("transactions").delete().eq("id", id);
  if (delErr) return { error: delErr.message };

  return finishWithRebuild(supabase);
}

export async function overrideTransaction(values: OverrideFormValues): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = overrideTransactionSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: txn, error: fetchErr } = await supabase
    .from("transactions")
    .select("id, user_override")
    .eq("id", v.id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!txn) return { error: "Transaction not found" };

  // Merge onto the existing override; null clears a key. An empty result is
  // stored as SQL null so `corrected` stays honest.
  const merged: Record<string, string> = {
    ...((txn.user_override as Record<string, string> | null) ?? {}),
  };
  for (const key of ["category", "description"] as const) {
    const value = v[key];
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }

  const update: Record<string, unknown> = {
    user_override: Object.keys(merged).length > 0 ? merged : null,
  };
  if (v.notes !== undefined) update.notes = v.notes || null;

  const { error: updateErr } = await supabase.from("transactions").update(update).eq("id", v.id);
  if (updateErr) return { error: updateErr.message };

  // Overrides never touch amount/date/direction → no rebuild (invariant).
  revalidatePath("/transactions");
  revalidatePath("/report");
  return { error: "" };
}
