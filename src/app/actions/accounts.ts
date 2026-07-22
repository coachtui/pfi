"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import { paginateSelect } from "@/lib/data/paginate";
import { PDF_IMPORT_BUCKET } from "@/lib/pdf-import/types";
import {
  accountSchema,
  updateAccountSchema,
  type AccountFormValues,
  type MutationResult,
} from "@/lib/validation/transactions";

export async function createAccount(values: AccountFormValues): Promise<MutationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = accountSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: created, error: insertErr } = await supabase
    .from("financial_accounts")
    .insert({
      user_id: user.id,
      provider: "manual",
      type: v.type,
      display_name: v.displayName,
      institution: v.institution || null,
      current_balance: v.currentBalance,
      credit_limit: v.creditLimit ?? null,
      interest_rate: v.interestRate ?? null,
    })
    .select("id")
    .single();
  if (insertErr) return { error: insertErr.message };

  // The typed starting balance is the account's first anchor (dated today).
  // Anchor failure degrades to legacy anchorless behavior, not a lost account.
  const { error: anchorErr } = await supabase.from("balance_anchors").insert({
    user_id: user.id,
    account_id: created.id,
    anchor_date: new Date().toISOString().slice(0, 10),
    balance: v.currentBalance,
    source: "manual",
  });

  const finish = await finishWithRebuild(supabase);
  if (anchorErr)
    return {
      ...finish,
      warning: [
        finish.warning,
        `Account saved, but its balance anchor wasn't recorded: ${anchorErr.message}`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  return finish;
}

export async function updateAccount(
  values: AccountFormValues & { id: string },
): Promise<MutationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = updateAccountSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: account, error: fetchErr } = await supabase
    .from("financial_accounts")
    .select("id, provider, current_balance")
    .eq("id", v.id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider !== "manual") {
    return { error: "Demo accounts can't be edited — reload demo data to reset them" };
  }

  const { error: updateErr } = await supabase
    .from("financial_accounts")
    .update({
      type: v.type,
      display_name: v.displayName,
      institution: v.institution || null,
      current_balance: v.currentBalance,
      credit_limit: v.creditLimit ?? null,
      interest_rate: v.interestRate ?? null,
    })
    .eq("id", v.id);
  if (updateErr) return { error: updateErr.message };

  // A changed balance is a fresh manual anchor dated today. A rename-only
  // edit (balance unchanged) is not — and deliberately doesn't refresh
  // freshness, since the user re-typed, not re-verified, the number.
  if (v.currentBalance !== Number(account.current_balance)) {
    const { error: anchorErr } = await supabase.from("balance_anchors").insert({
      user_id: user.id,
      account_id: v.id,
      anchor_date: new Date().toISOString().slice(0, 10),
      balance: v.currentBalance,
      source: "manual",
    });
    if (anchorErr) {
      const finish = await finishWithRebuild(supabase);
      return {
        ...finish,
        warning: [
          finish.warning,
          `Saved, but the balance anchor wasn't recorded: ${anchorErr.message}`,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
  }

  return finishWithRebuild(supabase);
}

const ACCOUNT_DELETE_PAGE_SIZE = 1000;

type AccountDeleteTransaction = {
  id: string;
  account_id: string;
  import_batch_id: string | null;
  transfer_pair_id: string | null;
};

/**
 * Permanently removes a user-owned manual account and its financial data.
 * Imported batch metadata is also removed when the batch belongs solely to
 * this account, so a deleted PDF does not keep blocking a later upload.
 */
export async function deleteAccount(id: string): Promise<MutationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(id).success) return { error: "Invalid account" };

  const { data: account, error: accountErr } = await supabase
    .from("financial_accounts")
    .select("id, provider, display_name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (accountErr) return { error: accountErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider !== "manual") {
    return { error: "Only your manually created accounts can be deleted here" };
  }

  let transactions: AccountDeleteTransaction[];
  try {
    transactions = await paginateSelect<AccountDeleteTransaction>(
      ACCOUNT_DELETE_PAGE_SIZE,
      (from, to) =>
        supabase
          .from("transactions")
          .select("id, account_id, import_batch_id, transfer_pair_id")
          .eq("user_id", user.id)
          .order("id", { ascending: true })
          .range(from, to),
    );
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to check account transactions",
    };
  }

  const accountTransactionIds = new Set(
    transactions.filter((row) => row.account_id === id).map((row) => row.id),
  );
  const linkedTransfers = transactions.filter(
    (row) =>
      row.account_id !== id &&
      row.transfer_pair_id !== null &&
      accountTransactionIds.has(row.transfer_pair_id),
  );
  if (linkedTransfers.length > 0) {
    const label = linkedTransfers.length === 1 ? "transfer" : "transfers";
    return {
      error: `This account is linked to ${linkedTransfers.length} ${label} on other accounts. Archive it instead so those records stay accurate.`,
    };
  }

  let accountAnchors: Array<{ import_batch_id: string | null }>;
  try {
    accountAnchors = await paginateSelect<{ import_batch_id: string | null }>(
      ACCOUNT_DELETE_PAGE_SIZE,
      (from, to) =>
        supabase
          .from("balance_anchors")
          .select("import_batch_id")
          .eq("user_id", user.id)
          .eq("account_id", id)
          .order("id", { ascending: true })
          .range(from, to),
    );
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to check account balance history",
    };
  }

  const candidateBatchIds = new Set<string>();
  for (const row of transactions) {
    if (row.account_id === id && row.import_batch_id) candidateBatchIds.add(row.import_batch_id);
  }
  for (const anchor of accountAnchors) {
    if (anchor.import_batch_id) candidateBatchIds.add(anchor.import_batch_id);
  }

  // A defensive ownership check keeps a malformed historical batch that spans
  // multiple accounts from being deleted along with only one of its accounts.
  const cleanableBatchIds = new Set(
    [...candidateBatchIds].filter((batchId) =>
      transactions.every((row) => row.import_batch_id !== batchId || row.account_id === id),
    ),
  );

  let importBatches: Array<{
    id: string;
    source_type: string;
    storage_path: string | null;
  }> = [];
  if (cleanableBatchIds.size > 0) {
    try {
      const allBatches = await paginateSelect<{
        id: string;
        source_type: string;
        storage_path: string | null;
      }>(ACCOUNT_DELETE_PAGE_SIZE, (from, to) =>
        supabase
          .from("import_batches")
          .select("id, source_type, storage_path")
          .eq("user_id", user.id)
          .order("id", { ascending: true })
          .range(from, to),
      );
      importBatches = allBatches.filter((batch) => cleanableBatchIds.has(batch.id));
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to check account import history",
      };
    }
  }

  const { data: deleted, error: deleteErr } = await supabase
    .from("financial_accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("provider", "manual")
    .select("id");
  if (deleteErr) return { error: deleteErr.message };
  if (!deleted || deleted.length === 0) return { error: "Account not found" };

  const cleanupWarnings: string[] = [];
  const pdfPaths = importBatches
    .filter((batch) => batch.source_type === "pdf" && batch.storage_path)
    .map((batch) => batch.storage_path as string);
  for (let index = 0; index < pdfPaths.length; index += 100) {
    const { error } = await supabase.storage
      .from(PDF_IMPORT_BUCKET)
      .remove(pdfPaths.slice(index, index + 100));
    if (error) {
      cleanupWarnings.push("The account was deleted, but a private statement file needs cleanup.");
      break;
    }
  }

  const batchIds = importBatches.map((batch) => batch.id);
  for (let index = 0; index < batchIds.length; index += 100) {
    const { error } = await supabase
      .from("import_batches")
      .delete()
      .eq("user_id", user.id)
      .in("id", batchIds.slice(index, index + 100));
    if (error) {
      cleanupWarnings.push(
        "The account was deleted, but part of its import history needs cleanup.",
      );
      break;
    }
  }

  const finish = await finishWithRebuild(supabase);
  const warning = [...new Set([finish.warning, ...cleanupWarnings].filter(Boolean))].join(" ");
  return warning ? { error: "", warning } : { error: "" };
}

export async function setAccountIncluded(id: string, included: boolean): Promise<MutationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(id).success) return { error: "Invalid account" };

  const { error } = await supabase
    .from("financial_accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: error.message };

  return finishWithRebuild(supabase);
}
