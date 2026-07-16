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

  const { error: insertErr } = await supabase.from("financial_accounts").insert({
    user_id: user.id, provider: "manual", type: v.type, display_name: v.displayName,
    institution: v.institution || null, current_balance: v.currentBalance,
    credit_limit: v.creditLimit ?? null, interest_rate: v.interestRate ?? null,
  });
  if (insertErr) return { error: insertErr.message };

  return finishWithRebuild(supabase);
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
    .from("financial_accounts").select("id, provider").eq("id", v.id).maybeSingle();
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
