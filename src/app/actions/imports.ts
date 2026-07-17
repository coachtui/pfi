"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dedupeKey } from "@/lib/csv-import/dedupe";
import { dayGap, TRANSFER_MAX_DAY_GAP } from "@/lib/csv-import/transfers";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import { insertChunked } from "@/lib/data/insert-chunked";
import { importTransactionsSchema, type ImportResult, type ImportTransactionsInput } from "@/lib/validation/imports";
import type { MutationResult } from "@/lib/validation/transactions";

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
    .select("id, provider, archived_at")
    .eq("id", v.accountId)
    .maybeSingle();
  if (acctErr) return { error: acctErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider === "demo") return { error: "Imports go into your own accounts, not demo data" };
  if (account.archived_at) return { error: "This account is archived" };

  // Server-side dedupe re-check against current DB state (stale-client/race guard).
  const { data: existingRows, error: exErr } = await supabase
    .from("transactions")
    .select("id, account_id, posted_date, amount, direction, description, is_transfer, transfer_pair_id");
  if (exErr) return { error: exErr.message };
  const existing = (existingRows ?? []).map((t) => ({
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

  const finish = await finishWithRebuild(supabase);
  return { ...finish, batchId, imported: inserts.length, skippedDuplicates };
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

  return finishWithRebuild(supabase);
}
