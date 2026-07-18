"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dedupeKey } from "@/lib/csv-import/dedupe";
import { dayGap, TRANSFER_MAX_DAY_GAP } from "@/lib/csv-import/transfers";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import { insertChunked } from "@/lib/data/insert-chunked";
import { paginateSelect } from "@/lib/data/paginate";
import {
  computeDiscrepancy, effectiveAnchor,
  type AccountInput, type AccountType, type BalanceAnchor, type TransactionInput,
} from "@/lib/financial-engine";
import { importTransactionsSchema, type ImportResult, type ImportTransactionsInput } from "@/lib/validation/imports";
import type { MutationResult } from "@/lib/validation/transactions";

// PostgREST caps unbounded selects at 1000 rows (see DECISIONS #18); the
// dedupe/transfer re-check below needs every existing transaction, not just
// the first page, or rows past the cap would re-import as duplicates.
const EXISTING_TXN_PAGE_SIZE = 1000;

/** Commit an import batch. The client's dedupe/transfer output is advisory:
 * everything is re-validated here against current DB state. All-or-nothing —
 * a failed chunk rolls the whole batch back. */
export async function importTransactions(input: ImportTransactionsInput): Promise<ImportResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = importTransactionsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: account, error: acctErr } = await supabase
    .from("financial_accounts")
    .select("id, provider, type, archived_at")
    .eq("id", v.accountId)
    .maybeSingle();
  if (acctErr) return { error: acctErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider === "demo") return { error: "Imports go into your own accounts, not demo data" };
  if (account.archived_at) return { error: "This account is archived" };

  // Server-side dedupe re-check against current DB state (stale-client/race guard).
  let existingRows: Array<{
    id: string; account_id: string; posted_date: string; amount: number;
    direction: string; description: string; is_transfer: boolean; transfer_pair_id: string | null;
  }>;
  try {
    existingRows = await paginateSelect(EXISTING_TXN_PAGE_SIZE, (from, to) =>
      supabase.from("transactions")
        .select("id, account_id, posted_date, amount, direction, description, is_transfer, transfer_pair_id")
        .order("id", { ascending: true })
        .range(from, to));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to read existing transactions" };
  }
  const existing = existingRows.map((t) => ({
    id: t.id as string,
    accountId: t.account_id as string,
    postedDate: t.posted_date as string,
    amount: Number(t.amount),
    direction: t.direction as "inflow" | "outflow",
    description: t.description as string,
    isTransfer: t.is_transfer as boolean,
    transferPairId: t.transfer_pair_id as string | null,
  }));

  const seen = new Set(
    existing.filter((t) => t.accountId === v.accountId).map((t) => dedupeKey(v.accountId, t)),
  );
  const fresh: typeof v.rows = [];
  let skippedDuplicates = 0;
  for (const r of v.rows) {
    const key = dedupeKey(v.accountId, r);
    if (seen.has(key)) { skippedDuplicates++; continue; }
    seen.add(key);
    fresh.push(r);
  }
  if (fresh.length === 0) return { error: "Nothing new to import — every row already exists" };

  // Re-validate transfer pairs; invalid ones are dropped (the row still
  // imports, unflagged) rather than failing the whole import.
  const byId = new Map(existing.map((t) => [t.id, t]));
  const byLine = new Map(fresh.map((r) => [r.line, r]));
  const usedExisting = new Set<string>();
  const pairByLine = new Map<number, string>();
  for (const p of v.transferPairs) {
    const row = byLine.get(p.line);
    const other = byId.get(p.existingId);
    if (!row || !other || usedExisting.has(other.id)) continue;
    if (other.accountId === v.accountId || other.transferPairId !== null) continue;
    if (other.direction === row.direction || other.amount !== row.amount) continue;
    if (dayGap(other.postedDate, row.postedDate) > TRANSFER_MAX_DAY_GAP) continue;
    usedExisting.add(other.id);
    pairByLine.set(p.line, other.id);
  }

  const batchId = randomUUID();
  const inserts = fresh.map((r) => {
    const pairedWith = pairByLine.get(r.line) ?? null;
    return {
      account_id: v.accountId,
      user_id: user.id,
      posted_date: r.postedDate,
      amount: r.amount,
      direction: r.direction,
      description: r.description,
      category: r.category,
      is_transfer: pairedWith !== null,
      transfer_pair_id: pairedWith,
      import_batch_id: batchId,
    };
  });

  try {
    await insertChunked(supabase, "transactions", inserts);
  } catch (e) {
    // All-or-nothing: remove whatever landed before the failing chunk.
    const { error: cleanupErr } = await supabase.from("transactions").delete().eq("import_batch_id", batchId);
    const baseMessage = e instanceof Error ? e.message : "Import failed";
    if (cleanupErr) {
      return {
        error: `${baseMessage} — cleanup also failed, some rows may remain (batch ${batchId}). Contact support with this batch id.`,
      };
    }
    return { error: `${baseMessage} — nothing was saved` };
  }

  // Statement anchor (optional): server-side reconciliation over existing +
  // just-inserted rows — the client's preview math is advisory. The anchor
  // row is provenance; the rebuild below derives current_balance from it.
  let anchorFacts: Pick<ImportResult, "anchorDate" | "anchoredBalance" | "discrepancy"> = {};
  if (v.endingBalance !== undefined && v.anchorDate !== undefined) {
    let priorAnchors: BalanceAnchor[] = [];
    try {
      const anchorRows = await paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(
        EXISTING_TXN_PAGE_SIZE,
        (from, to) =>
          supabase.from("balance_anchors")
            .select("account_id, anchor_date, balance, created_at")
            .eq("account_id", v.accountId)
            .order("id", { ascending: true })
            .range(from, to),
      );
      priorAnchors = anchorRows.map((r) => ({
        accountId: r.account_id, anchorDate: r.anchor_date, balance: Number(r.balance), createdAt: r.created_at,
      }));
    } catch (e) {
      const finish = await finishWithRebuild(supabase);
      return {
        ...finish,
        warning: [finish.warning, `Imported, but the balance anchor could not be saved: ${e instanceof Error ? e.message : "anchor lookup failed"}`].filter(Boolean).join(" "),
        batchId, imported: inserts.length, skippedDuplicates,
      };
    }

    const acctForMath: AccountInput = {
      id: v.accountId, type: account.type as AccountType, currentBalance: 0, includeInCalculations: true,
    };
    const mathTxns: TransactionInput[] = [
      ...existing
        .filter((t) => t.accountId === v.accountId)
        .map((t) => ({
          id: t.id, accountId: t.accountId, postedDate: t.postedDate, amount: t.amount,
          direction: t.direction, description: t.description, category: null,
          essential: null, isTransfer: t.isTransfer, transferPairId: t.transferPairId,
        })),
      ...inserts.map((r, i) => ({
        id: `pending-${i}`, accountId: r.account_id, postedDate: r.posted_date, amount: r.amount,
        direction: r.direction as "inflow" | "outflow", description: r.description, category: null,
        essential: null, isTransfer: r.is_transfer, transferPairId: null,
      })),
    ];
    const eff = effectiveAnchor(priorAnchors);
    const discrepancy = computeDiscrepancy(acctForMath, eff, v.endingBalance, v.anchorDate, mathTxns);

    const { error: anchorInsErr } = await supabase.from("balance_anchors").insert({
      user_id: user.id, account_id: v.accountId, anchor_date: v.anchorDate,
      balance: v.endingBalance, source: "import", import_batch_id: batchId, discrepancy,
    });
    if (anchorInsErr) {
      const finish = await finishWithRebuild(supabase);
      return {
        ...finish,
        warning: [finish.warning, `Imported, but the balance anchor could not be saved: ${anchorInsErr.message}`].filter(Boolean).join(" "),
        batchId, imported: inserts.length, skippedDuplicates,
      };
    }
    anchorFacts = { anchorDate: v.anchorDate, anchoredBalance: v.endingBalance, discrepancy };
  }

  const finish = await finishWithRebuild(supabase);
  return { ...finish, ...anchorFacts, batchId, imported: inserts.length, skippedDuplicates };
}

/** Remove exactly one import batch's rows, then rebuild. */
export async function undoImport(batchId: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(batchId).success) return { error: "Invalid import" };

  const { data: deleted, error: delErr } = await supabase
    .from("transactions")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("user_id", user.id)
    .select("id");
  if (delErr) return { error: delErr.message };
  if (!deleted || deleted.length === 0) return { error: "Import not found" };

  // The batch's anchor (if any) claims a statement that no longer exists in
  // the data — remove it; the rebuild re-derives current_balance from the
  // remaining effective anchor.
  const { error: anchorDelErr } = await supabase
    .from("balance_anchors")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("user_id", user.id);
  if (anchorDelErr) {
    const finish = await finishWithRebuild(supabase);
    return {
      ...finish,
      warning: [finish.warning, `Undone, but the batch's balance anchor could not be removed: ${anchorDelErr.message}`].filter(Boolean).join(" "),
    };
  }

  return finishWithRebuild(supabase);
}
