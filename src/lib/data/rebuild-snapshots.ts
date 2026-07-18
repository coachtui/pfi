import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDailySnapshots, deriveRebuildConfig,
  type AccountInput, type AccountType,
} from "@/lib/financial-engine";
import { rowToTransactionInput, snapshotToRow, type TransactionRow } from "./mappers";
import { insertChunked } from "./insert-chunked";
import { paginateSelect } from "./paginate";

// PostgREST caps unbounded selects at 1000 rows; a demo profile or long-lived
// real account can exceed that, which used to silently truncate the
// obligation-window computation to zero for the missing tail (found live:
// Blue Reef Partners' 1042 transactions left near_term_obligations = 0 for
// every day after the 1000th row's date).
const PAGE_SIZE = 1000;

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

    const [acctRes, transactionRows, priorRows] = await Promise.all([
      supabase.from("financial_accounts")
        .select("id, type, current_balance, include_in_calculations, archived_at"),
      paginateSelect<TransactionRow>(PAGE_SIZE, (from, to) =>
        supabase.from("transactions")
          .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id")
          .order("id", { ascending: true })
          .range(from, to)),
      paginateSelect<{ date: string; safety_buffer: number }>(PAGE_SIZE, (from, to) =>
        supabase.from("daily_snapshots")
          .select("date, safety_buffer")
          .order("date", { ascending: true })
          .range(from, to)),
    ]);
    if (acctRes.error) throw new Error(acctRes.error.message);

    const active = (acctRes.data as RebuildAccountRow[]).filter((a) => a.archived_at === null);
    const activeIds = new Set(active.map((a) => a.id));
    const accounts: AccountInput[] = active.map((a) => ({
      id: a.id,
      type: a.type as AccountType,
      currentBalance: Number(a.current_balance ?? 0),
      includeInCalculations: a.include_in_calculations,
    }));
    const transactions = transactionRows
      .map(rowToTransactionInput)
      .filter((t) => activeIds.has(t.accountId));
    const prior = priorRows.map((p) => ({
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
