import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import { ENGINE_VERSION } from "@/lib/financial-engine";
import type { DemoAccount, DemoTransaction } from "@/lib/demo-data/koa-holdings";

export interface SnapshotRow {
  user_id: string; date: string; liquid_assets: number; revolving_balances: number;
  near_term_obligations: number; essential_obligations: number; safety_buffer: number;
  net_worth: number; engine_version: string; data_coverage_confidence: string;
}

export function snapshotToRow(userId: string, s: DailySnapshot): SnapshotRow {
  return {
    user_id: userId, date: s.date, liquid_assets: s.liquidAssets,
    revolving_balances: s.revolvingBalances, near_term_obligations: s.nearTermObligations,
    essential_obligations: s.essentialObligations, safety_buffer: s.safetyBuffer,
    net_worth: s.netWorth, engine_version: ENGINE_VERSION, data_coverage_confidence: "demo",
  };
}

export function rowToSnapshot(row: SnapshotRow): DailySnapshot {
  return {
    date: row.date, liquidAssets: Number(row.liquid_assets),
    revolvingBalances: Number(row.revolving_balances),
    nearTermObligations: Number(row.near_term_obligations),
    essentialObligations: Number(row.essential_obligations),
    safetyBuffer: Number(row.safety_buffer), netWorth: Number(row.net_worth),
  };
}

export interface EventRow {
  id?: string; user_id: string; date: string; type: string; label: string;
  amount: number; direction: string;
}

export function eventToRow(userId: string, e: FinancialEvent): EventRow {
  return { user_id: userId, date: e.date, type: e.type, label: e.label, amount: e.amount, direction: e.direction };
}

export function rowToEvent(row: EventRow & { id: string }): FinancialEvent {
  return {
    id: row.id, date: row.date, type: row.type as FinancialEvent["type"],
    label: row.label, amount: Number(row.amount),
    direction: row.direction as FinancialEvent["direction"],
  };
}

export function demoAccountToRow(userId: string, a: DemoAccount): Record<string, unknown> {
  return {
    user_id: userId, provider: a.provider, institution: a.institution, type: a.type,
    subtype: a.subtype, display_name: a.displayName, mask: a.mask,
    current_balance: a.currentBalance, include_in_calculations: a.includeInCalculations,
    connection_status: "ok", last_synced_at: new Date().toISOString(),
  };
}

/**
 * Demo transactions carry generator-local ids ("koa-t-3"); the DB assigns
 * uuids. `accountIdMap` maps generator account ids → DB uuids and `txnIdMap`
 * maps generator txn ids → pre-allocated DB uuids so transfer pairs stay linked.
 */
export function demoTransactionToRow(
  userId: string,
  accountIdMap: Map<string, string>,
  txnIdMap: Map<string, string>,
  t: DemoTransaction,
): Record<string, unknown> {
  return {
    id: txnIdMap.get(t.id), account_id: accountIdMap.get(t.accountId), user_id: userId,
    posted_date: t.postedDate, amount: t.amount, direction: t.direction,
    description: t.description, category: t.category, essential: t.essential,
    is_transfer: t.isTransfer,
    transfer_pair_id: t.transferPairId ? (txnIdMap.get(t.transferPairId) ?? null) : null,
  };
}
