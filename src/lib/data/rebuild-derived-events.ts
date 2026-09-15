import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EVENT_DERIVATION_VERSION, applyOverride, deriveEvents, detectRecurringSeries, effectiveAnchor, liabilityBalanceHistory,
  parseOverride, LIABILITY_TYPES,
  type AccountInput, type AccountType, type BalanceAnchor, type EventAccountInput, type EventSeriesInput,
  type EventTransactionInput, type LiabilityBalancePoint, type TransactionInput,
} from "@/lib/financial-engine";
import { insertChunked } from "./insert-chunked";
import type { TransactionRow } from "./mappers";

export interface DerivationAccountRow {
  id: string; type: string; provider: string; include_in_calculations: boolean; archived_at: string | null;
}

export interface DerivationTransactionRow extends TransactionRow {
  user_override: unknown;
  pfc_primary?: string | null;
  pfc_detailed?: string | null;
}

export interface DerivedEventsSource {
  accounts: DerivationAccountRow[];
  /** Every transaction of the user (source columns + override + Plaid category). */
  transactions: DerivationTransactionRow[];
  recurringOverrides: { series_key: string; status: string }[];
  anchorsByAccount: Map<string, BalanceAnchor[]>;
  /** Newest known date in the data (the rebuild's endDate); null when there is no data. */
  referenceDate: string | null;
}

/**
 * Replace the user's `source = 'derived'` financial_events with a fresh
 * derivation (docs/DRIVER_EVENTS.md). Runs at the tail of every snapshot
 * rebuild so it sees the same accounts/transactions/overrides the index saw.
 * Demo rows (`source = 'demo'`) are never touched. Throws on failure; the
 * caller turns that into the rebuild warning and retries on the next rebuild.
 */
export async function rebuildDerivedEvents(supabase: SupabaseClient, userId: string, src: DerivedEventsSource): Promise<number> {
  const rows = derive(src).map((e) => ({
    user_id: userId, date: e.date, type: e.type, label: e.label, amount: e.amount, direction: e.direction,
    source: "derived", transaction_id: e.transactionId, derivation_version: EVENT_DERIVATION_VERSION,
  }));

  const del = await supabase.from("financial_events").delete().eq("user_id", userId).eq("source", "derived");
  if (del.error) throw new Error(`derived events: ${del.error.message}`);
  if (rows.length > 0) await insertChunked(supabase, "financial_events", rows);
  return rows.length;
}

/** Pure assembly of engine inputs from rows; exported for tests. */
export function derive(src: DerivedEventsSource): ReturnType<typeof deriveEvents> {
  const active = src.accounts.filter((a) => a.archived_at === null);
  const activeIds = new Set(active.map((a) => a.id));
  const eventAccounts: EventAccountInput[] = src.accounts.map((a) => ({
    id: a.id, type: a.type as AccountType, provider: a.provider,
    includeInCalculations: a.include_in_calculations, archived: a.archived_at !== null,
  }));
  // Anything derivable is off demo accounts; skip the work entirely when nothing qualifies.
  if (!eventAccounts.some((a) => a.provider !== "demo" && a.includeInCalculations && !a.archived)) return [];

  // Source-column transactions drive series detection (same as the Recurring
  // page, whose confirm/dismiss keys are built from source descriptions).
  const sourceTxns: TransactionInput[] = src.transactions
    .filter((r) => activeIds.has(r.account_id))
    .map((r) => ({
      id: r.id, accountId: r.account_id, postedDate: r.posted_date, amount: Number(r.amount),
      direction: r.direction as TransactionInput["direction"], description: r.description,
      category: r.category, essential: r.essential, isTransfer: r.is_transfer, transferPairId: r.transfer_pair_id,
    }));
  const pfcById = new Map(src.transactions.map((r) => [r.id, { primary: r.pfc_primary ?? null, detailed: r.pfc_detailed ?? null, override: parseOverride(r.user_override) }]));

  const seriesAccounts: AccountInput[] = active
    .filter((a) => a.include_in_calculations)
    .map((a) => ({ id: a.id, type: a.type as AccountType, currentBalance: 0, includeInCalculations: true }));
  const statusByKey = new Map(src.recurringOverrides.map((r) => [r.series_key, r.status as "confirmed" | "dismissed"]));
  const series: EventSeriesInput[] = src.referenceDate && sourceTxns.length > 0
    ? detectRecurringSeries(seriesAccounts, sourceTxns, src.referenceDate).map((s) => ({
        seriesKey: s.seriesKey, displayName: s.displayName, cadence: s.cadence, typicalAmount: s.typicalAmount,
        occurrenceCount: s.occurrenceCount, confidence: s.confidence, isIncome: s.isIncome, status: statusByKey.get(s.seriesKey) ?? null,
      }))
    : [];

  // Effective category (override applied) is what the rules read.
  const transactions: EventTransactionInput[] = sourceTxns.map((t) => {
    const extra = pfcById.get(t.id);
    const effective = applyOverride({ ...t, userOverride: extra?.override ?? null });
    return {
      id: t.id, accountId: t.accountId, postedDate: t.postedDate, amount: t.amount, direction: t.direction,
      category: effective.category, isTransfer: t.isTransfer, transferPairId: t.transferPairId,
      description: t.description, pfcPrimary: extra?.primary ?? null, pfcDetailed: extra?.detailed ?? null,
    };
  });

  // Liability balance history from each liability's effective anchor (payoff detection only).
  const liabilityBalances: LiabilityBalancePoint[] = [];
  for (const a of active) {
    const type = a.type as AccountType;
    if (!LIABILITY_TYPES.has(type)) continue;
    const anchor = effectiveAnchor(src.anchorsByAccount.get(a.id) ?? []);
    if (!anchor) continue;
    const account: AccountInput = { id: a.id, type, currentBalance: 0, includeInCalculations: a.include_in_calculations };
    liabilityBalances.push(...liabilityBalanceHistory(account, anchor, sourceTxns));
  }

  return deriveEvents({ accounts: eventAccounts, transactions, series, liabilityBalances });
}
