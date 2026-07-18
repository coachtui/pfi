"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import {
  accountSchema, updateAccountSchema,
  type AccountFormValues, type MutationResult,
} from "@/lib/validation/transactions";

export async function createAccount(values: AccountFormValues): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = accountSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: created, error: insertErr } = await supabase
    .from("financial_accounts")
    .insert({
      user_id: user.id, provider: "manual", type: v.type, display_name: v.displayName,
      institution: v.institution || null, current_balance: v.currentBalance,
      credit_limit: v.creditLimit ?? null, interest_rate: v.interestRate ?? null,
    })
    .select("id")
    .single();
  if (insertErr) return { error: insertErr.message };

  // The typed starting balance is the account's first anchor (dated today).
  // Anchor failure degrades to legacy anchorless behavior, not a lost account.
  const { error: anchorErr } = await supabase.from("balance_anchors").insert({
    user_id: user.id, account_id: created.id, anchor_date: new Date().toISOString().slice(0, 10),
    balance: v.currentBalance, source: "manual",
  });

  const finish = await finishWithRebuild(supabase);
  if (anchorErr) return { ...finish, warning: [finish.warning, `Account saved, but its balance anchor wasn't recorded: ${anchorErr.message}`].filter(Boolean).join(" ") };
  return finish;
}

export async function updateAccount(
  values: AccountFormValues & { id: string },
): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = updateAccountSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: account, error: fetchErr } = await supabase
    .from("financial_accounts").select("id, provider, current_balance").eq("id", v.id).maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider !== "manual") {
    return { error: "Demo accounts can't be edited — reload demo data to reset them" };
  }

  const { error: updateErr } = await supabase
    .from("financial_accounts")
    .update({
      type: v.type, display_name: v.displayName, institution: v.institution || null,
      current_balance: v.currentBalance, credit_limit: v.creditLimit ?? null,
      interest_rate: v.interestRate ?? null,
    })
    .eq("id", v.id);
  if (updateErr) return { error: updateErr.message };

  // A changed balance is a fresh manual anchor dated today. A rename-only
  // edit (balance unchanged) is not — and deliberately doesn't refresh
  // freshness, since the user re-typed, not re-verified, the number.
  if (v.currentBalance !== Number(account.current_balance)) {
    const { error: anchorErr } = await supabase.from("balance_anchors").insert({
      user_id: user.id, account_id: v.id, anchor_date: new Date().toISOString().slice(0, 10),
      balance: v.currentBalance, source: "manual",
    });
    if (anchorErr) {
      const finish = await finishWithRebuild(supabase);
      return { ...finish, warning: [finish.warning, `Saved, but the balance anchor wasn't recorded: ${anchorErr.message}`].filter(Boolean).join(" ") };
    }
  }

  return finishWithRebuild(supabase);
}

export async function setAccountIncluded(id: string, included: boolean): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(id).success) return { error: "Invalid account" };

  const { error } = await supabase
    .from("financial_accounts")
    .update({ include_in_calculations: included })
    .eq("id", id);
  if (error) return { error: error.message };

  return finishWithRebuild(supabase);
}

export async function setAccountArchived(id: string, archived: boolean): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(id).success) return { error: "Invalid account" };

  const { error } = await supabase
    .from("financial_accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: error.message };

  return finishWithRebuild(supabase);
}
