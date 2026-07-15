import type { DailySnapshot, ISODate } from "./types";

export const ENGINE_VERSION = "1.0.0";

export type AccountType =
  | "checking" | "savings" | "money_market" | "credit_card" | "mortgage"
  | "auto_loan" | "student_loan" | "personal_loan" | "brokerage"
  | "retirement" | "property" | "other_asset" | "other_liability";

const LIQUID_TYPES: ReadonlySet<AccountType> = new Set(["checking", "savings", "money_market"]);
const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set([
  "credit_card", "mortgage", "auto_loan", "student_loan", "personal_loan", "other_liability",
]);

export interface AccountInput {
  id: string;
  type: AccountType;
  /** Balance as of config.endDate. Positive for liabilities too. */
  currentBalance: number;
  includeInCalculations: boolean;
}

export interface TransactionInput {
  id: string;
  accountId: string;
  postedDate: ISODate;
  amount: number;
  direction: "inflow" | "outflow";
  /** "income" marks income events used for obligation windows. */
  category: string | null;
  essential: boolean | null;
  isTransfer: boolean;
  transferPairId: string | null;
}

export interface SnapshotBuilderConfig {
  startDate: ISODate;
  endDate: ISODate;
  safetyBuffer: number;
}

export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function enumerateDates(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Signed balance change for an account on one day. */
function dayDelta(account: AccountInput, txns: TransactionInput[]): number {
  let delta = 0;
  for (const t of txns) {
    if (t.accountId !== account.id) continue;
    const flow = t.direction === "inflow" ? t.amount : -t.amount;
    delta += LIABILITY_TYPES.has(account.type) ? -flow : flow;
  }
  return delta;
}

export function buildDailySnapshots(
  accounts: AccountInput[],
  transactions: TransactionInput[],
  config: SnapshotBuilderConfig,
): DailySnapshot[] {
  const included = accounts.filter((a) => a.includeInCalculations);
  if (included.length === 0 || config.startDate > config.endDate) return [];

  const dates = enumerateDates(config.startDate, config.endDate);
  const byDate = new Map<ISODate, TransactionInput[]>();
  for (const t of transactions) {
    const list = byDate.get(t.postedDate) ?? [];
    list.push(t);
    byDate.set(t.postedDate, list);
  }

  // Backward replay: balance at end of each day, per account.
  const balances = new Map<ISODate, Map<string, number>>();
  let cursor = new Map(included.map((a) => [a.id, a.currentBalance]));
  balances.set(config.endDate, cursor);
  for (let i = dates.length - 1; i > 0; i--) {
    const day = dates[i];
    const dayTxns = byDate.get(day) ?? [];
    const prev = new Map(cursor);
    for (const a of included) {
      prev.set(a.id, (prev.get(a.id) ?? 0) - dayDelta(a, dayTxns));
    }
    balances.set(dates[i - 1], prev);
    cursor = prev;
  }

  return dates.map((date) => {
    const bal = balances.get(date)!;
    let liquid = 0;
    let revolving = 0;
    let assets = 0;
    let liabilities = 0;
    for (const a of included) {
      const b = bal.get(a.id) ?? 0;
      if (LIQUID_TYPES.has(a.type)) liquid += b;
      if (a.type === "credit_card") revolving += b;
      if (LIABILITY_TYPES.has(a.type)) liabilities += b;
      else assets += b;
    }
    const obligations = computeObligations(date, included, transactions, config);
    return {
      date,
      liquidAssets: round2(liquid),
      revolvingBalances: round2(revolving),
      nearTermObligations: round2(obligations.nearTerm),
      essentialObligations: round2(obligations.essential),
      safetyBuffer: config.safetyBuffer,
      netWorth: round2(assets - liabilities),
    };
  });
}

// Implemented in Task 5. Returning zeros keeps Task 4 green in isolation.
function computeObligations(
  _date: ISODate,
  _accounts: AccountInput[],
  _transactions: TransactionInput[],
  _config: SnapshotBuilderConfig,
): { nearTerm: number; essential: number } {
  return { nearTerm: 0, essential: 0 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
