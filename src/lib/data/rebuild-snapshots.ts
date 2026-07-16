import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDailySnapshots, deriveRebuildConfig,
  type AccountInput, type AccountType,
} from "@/lib/financial-engine";
import { rowToTransactionInput, snapshotToRow, type TransactionRow } from "./mappers";
import { insertChunked } from "./insert-chunked";

interface RebuildAccountRow {
  id: string; type: string; current_balance: number | null;
  include_in_calculations: boolean; archived_at: string | null;
}

/**
 * Recompute the user's daily_snapshots from source-of-truth accounts and
 * transactions (source columns only — overrides never move the index).
 * Idempotent: same inputs always produce the same rows. Returns an error
 * string instead of throwing so callers can degrade to a "recalculation
 * pending" state; the delete+insert is not transactional, and the stale-index
 * check plus retry-on-next-mutation covers the failure window.
 */
export async function rebuildSnapshots(supabase: SupabaseClient): Promise<{ error: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const [acctRes, txnRes, snapRes] = await Promise.all([
      supabase.from("financial_accounts")
        .select("id, type, current_balance, include_in_calculations, archived_at"),
      supabase.from("transactions")
        .select("id, account_id, posted_date, amount, direction, category, essential, is_transfer, transfer_pair_id"),
      supabase.from("daily_snapshots").select("date, safety_buffer"),
    ]);
    if (acctRes.error) throw new Error(acctRes.error.message);
    if (txnRes.error) throw new Error(txnRes.error.message);
    if (snapRes.error) throw new Error(snapRes.error.message);

    const active = (acctRes.data as RebuildAccountRow[]).filter((a) => a.archived_at === null);
    const activeIds = new Set(active.map((a) => a.id));
    const accounts: AccountInput[] = active.map((a) => ({
      id: a.id,
      type: a.type as AccountType,
      currentBalance: Number(a.current_balance ?? 0),
      includeInCalculations: a.include_in_calculations,
    }));
    const transactions = (txnRes.data as TransactionRow[])
      .map(rowToTransactionInput)
      .filter((t) => activeIds.has(t.accountId));
    const prior = (snapRes.data as Array<{ date: string; safety_buffer: number }>).map((p) => ({
      date: p.date,
      safetyBuffer: Number(p.safety_buffer),
    }));

    const config = deriveRebuildConfig(prior, transactions);

    const del = await supabase.from("daily_snapshots").delete().eq("user_id", user.id);
    if (del.error) throw new Error(del.error.message);

    if (config) {
      const snapshots = buildDailySnapshots(accounts, transactions, config);
      await insertChunked(supabase, "daily_snapshots", snapshots.map((s) => snapshotToRow(user.id, s)));
    }
    return { error: "" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Snapshot rebuild failed" };
  }
}
