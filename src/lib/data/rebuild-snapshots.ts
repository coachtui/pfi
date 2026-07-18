import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDailySnapshots, deriveRebuildConfig, effectiveAnchor, rollForwardBalance,
  type AccountInput, type AccountType, type BalanceAnchor, type RecurringOverride,
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
 * Recompute the user's daily_snapshots from source-of-truth accounts,
 * transactions, and recurring overrides. Transaction category and
 * description overrides never move the index (source columns only);
 * recurring confirm/dismiss deliberately does — it curates which series
 * project into the obligations window (see DECISIONS #23). Idempotent: same
 * inputs always produce the same rows. Returns an error string instead of
 * throwing so callers can degrade to a "recalculation pending" state; the
 * delete+insert is not transactional, and the stale-index check plus
 * retry-on-next-mutation covers the failure window. For accounts with
 * balance anchors, `current_balance` is corrected from the effective anchor
 * before building (DECISIONS #24); anchorless accounts keep their
 * hand-typed balance.
 */
export async function rebuildSnapshots(supabase: SupabaseClient): Promise<{ error: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const [acctRes, transactionRows, priorRows, overrideRows, anchorRows] = await Promise.all([
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
      paginateSelect<{ series_key: string; status: string }>(PAGE_SIZE, (from, to) =>
        supabase.from("recurring_overrides")
          .select("series_key, status")
          .order("series_key", { ascending: true })
          .range(from, to)),
      paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(PAGE_SIZE, (from, to) =>
        supabase.from("balance_anchors")
          .select("account_id, anchor_date, balance, created_at")
          .order("id", { ascending: true })
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
    const recurringOverrides: RecurringOverride[] = overrideRows.map((r) => ({
      seriesKey: r.series_key,
      status: r.status as RecurringOverride["status"],
    }));

    // Anchor-aware balance refresh: for accounts with balance anchors, the
    // stored current_balance is DERIVED — effective anchor rolled forward
    // through transactions after the anchor date. Correcting it here (inside
    // the rebuild every mutation already triggers) keeps the snapshot
    // builder's backward replay anchored on a true value, with zero changes
    // to the builder itself. Accounts without anchors keep legacy behavior:
    // their hand-typed balance stays authoritative.
    const anchorsByAccount = new Map<string, BalanceAnchor[]>();
    for (const r of anchorRows) {
      const list = anchorsByAccount.get(r.account_id) ?? [];
      list.push({
        accountId: r.account_id,
        anchorDate: r.anchor_date,
        balance: Number(r.balance),
        createdAt: r.created_at,
      });
      anchorsByAccount.set(r.account_id, list);
    }
    for (const a of accounts) {
      const eff = effectiveAnchor(anchorsByAccount.get(a.id) ?? []);
      if (!eff) continue;
      const corrected = rollForwardBalance(a, eff.balance, eff.anchorDate, transactions);
      if (corrected !== a.currentBalance) {
        const { error: balErr } = await supabase.from("financial_accounts")
          .update({ current_balance: corrected }).eq("id", a.id);
        if (balErr) throw new Error(balErr.message);
        a.currentBalance = corrected;
      }
    }

    const config = deriveRebuildConfig(prior, transactions);

    const del = await supabase.from("daily_snapshots").delete().eq("user_id", user.id);
    if (del.error) throw new Error(del.error.message);

    if (config) {
      const snapshots = buildDailySnapshots(accounts, transactions, config, recurringOverrides);
      await insertChunked(supabase, "daily_snapshots", snapshots.map((s) => snapshotToRow(user.id, s)));
    }
    return { error: "" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Snapshot rebuild failed" };
  }
}
