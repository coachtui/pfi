import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import {
  ENGINE_VERSION,
  applyOverride,
  parseOverride,
  type EffectiveTransaction,
  type AccountType,
} from "@/lib/financial-engine";
import type { DemoAccount, DemoTransaction } from "@/lib/demo-data/koa-holdings";
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";

export interface SnapshotRow {
  user_id: string; date: string; liquid_assets: number; revolving_balances: number;
  near_term_obligations: number; essential_obligations: number; safety_buffer: number;
  net_worth: number; engine_version: string;
}

export function snapshotToRow(userId: string, s: DailySnapshot): SnapshotRow {
  return {
    user_id: userId, date: s.date, liquid_assets: s.liquidAssets,
    revolving_balances: s.revolvingBalances, near_term_obligations: s.nearTermObligations,
    essential_obligations: s.essentialObligations, safety_buffer: s.safetyBuffer,
    net_worth: s.netWorth, engine_version: ENGINE_VERSION,
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
    credit_limit: a.creditLimit ?? null, interest_rate: a.interestRate ?? null,
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

export interface TransactionRow {
  id: string; account_id: string; posted_date: string; amount: number;
  direction: string; description: string; category: string | null; essential: boolean | null;
  is_transfer: boolean; transfer_pair_id: string | null;
}

export function rowToTransactionInput(row: TransactionRow): TransactionInput {
  return {
    id: row.id,
    accountId: row.account_id,
    postedDate: row.posted_date,
    amount: Number(row.amount),
    direction: row.direction as TransactionInput["direction"],
    description: row.description,
    category: row.category,
    essential: row.essential,
    isTransfer: row.is_transfer,
    transferPairId: row.transfer_pair_id,
  };
}

export interface TransactionListRow {
  id: string; account_id: string; posted_date: string; amount: number;
  direction: string; description: string; category: string | null;
  essential: boolean | null; is_transfer: boolean; transfer_pair_id: string | null;
  notes: string | null; user_override: unknown; import_batch_id: string | null;
  financial_accounts: { display_name: string; provider: string };
}

export interface TransactionListItem extends EffectiveTransaction {
  notes: string | null;
  accountName: string;
  accountProvider: "demo" | "manual" | "csv";
  importBatchId: string | null;
}

export function rowToTransactionListItem(row: TransactionListRow): TransactionListItem {
  const effective = applyOverride({
    id: row.id,
    accountId: row.account_id,
    postedDate: row.posted_date,
    amount: Number(row.amount),
    direction: row.direction as "inflow" | "outflow",
    description: row.description,
    category: row.category,
    essential: row.essential,
    isTransfer: row.is_transfer,
    transferPairId: row.transfer_pair_id,
    userOverride: parseOverride(row.user_override),
  });
  return {
    ...effective,
    notes: row.notes,
    accountName: row.financial_accounts.display_name,
    accountProvider: row.financial_accounts.provider as "demo" | "manual" | "csv",
    importBatchId: row.import_batch_id,
  };
}

export interface AccountRow {
  id: string; provider: string; institution: string | null; type: string;
  display_name: string; mask: string | null; current_balance: number | null;
  credit_limit: number | null; interest_rate: number | null;
  include_in_calculations: boolean; archived_at: string | null;
}

export interface AccountSummary {
  id: string; provider: "demo" | "manual" | "csv"; institution: string | null;
  type: AccountType; displayName: string; mask: string | null;
  currentBalance: number | null; creditLimit: number | null;
  interestRate: number | null; includeInCalculations: boolean;
  archivedAt: string | null;
}

export function rowToAccountSummary(row: AccountRow): AccountSummary {
  return {
    id: row.id,
    provider: row.provider as AccountSummary["provider"],
    institution: row.institution,
    type: row.type as AccountType,
    displayName: row.display_name,
    mask: row.mask,
    currentBalance: row.current_balance === null ? null : Number(row.current_balance),
    creditLimit: row.credit_limit === null ? null : Number(row.credit_limit),
    interestRate: row.interest_rate === null ? null : Number(row.interest_rate),
    includeInCalculations: row.include_in_calculations,
    archivedAt: row.archived_at,
  };
}

export interface RecentImport {
  batchId: string;
  accountName: string;
  rowCount: number;
  firstDate: string;
  lastDate: string;
  importedAt: string;
}
