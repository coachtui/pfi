import type { DailySnapshot, ISODate } from "./types";
import {
  detectRecurringSeries, nextOccurrenceAfter, occurrencesAfter,
  type RecurringOverride, type RecurringSeries,
} from "./recurring";

export const ENGINE_VERSION = "1.0.0";

export type AccountType =
  | "checking" | "savings" | "money_market" | "credit_card" | "mortgage"
  | "auto_loan" | "student_loan" | "personal_loan" | "brokerage"
  | "retirement" | "property" | "other_asset" | "other_liability";

export const LIQUID_TYPES: ReadonlySet<AccountType> = new Set(["checking", "savings", "money_market"]);
export const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set([
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
  description: string;
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

const DEFAULT_INCOME_GAP_DAYS = 15;
const PROXY_SHIFT_DAYS = 28;

function median(xs: number[]): number {
  if (xs.length === 0) return DEFAULT_INCOME_GAP_DAYS;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

interface ObligationContext {
  incomeDates: ISODate[];
  medianGap: number;
  liquidIds: Set<string>;
  liabilityIds: Set<string>;
  txnById: Map<string, TransactionInput>;
  projectedOutflows: RecurringSeries[];
  projectedIncome: RecurringSeries[];
}

function buildObligationContext(
  accounts: AccountInput[],
  transactions: TransactionInput[],
  projected: RecurringSeries[],
): ObligationContext {
  const liquidIds = new Set(accounts.filter((a) => LIQUID_TYPES.has(a.type)).map((a) => a.id));
  const liabilityIds = new Set(
    accounts.filter((a) => LIABILITY_TYPES.has(a.type)).map((a) => a.id),
  );
  const incomeDates = [
    ...new Set(
      transactions
        .filter(
          (t) =>
            t.direction === "inflow" && !t.isTransfer && t.category === "income" &&
            liquidIds.has(t.accountId),
        )
        .map((t) => t.postedDate),
    ),
  ].sort();
  const gaps = incomeDates.slice(1).map((d, i) => daysBetween(incomeDates[i], d));
  return {
    incomeDates,
    medianGap: median(gaps),
    liquidIds,
    liabilityIds,
    txnById: new Map(transactions.map((t) => [t.id, t])),
    projectedOutflows: projected.filter((s) => s.direction === "outflow" && !s.isIncome),
    projectedIncome: projected.filter((s) => s.isIncome),
  };
}

export function buildDailySnapshots(
  accounts: AccountInput[],
  transactions: TransactionInput[],
  config: SnapshotBuilderConfig,
  recurringOverrides: RecurringOverride[] = [],
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

  const overrideByKey = new Map(recurringOverrides.map((o) => [o.seriesKey, o.status]));
  // Dismissed series never project; confirmed series always do, even lapsed.
  const projected = detectRecurringSeries(included, transactions, config.endDate).filter(
    (s) =>
      overrideByKey.get(s.seriesKey) !== "dismissed" &&
      (!s.lapsed || overrideByKey.get(s.seriesKey) === "confirmed"),
  );
  const ctx = buildObligationContext(included, transactions, projected);

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
    const obligations = computeObligations(date, ctx, transactions, config);
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

function computeObligations(
  date: ISODate,
  ctx: ObligationContext,
  transactions: TransactionInput[],
  config: SnapshotBuilderConfig,
): { nearTerm: number; essential: number } {
  const nextIncome = ctx.incomeDates.find((d) => d > date);
  const fallbackGap = nextIncome ? daysBetween(date, nextIncome) : ctx.medianGap;
  let windowStart = date;
  let windowEnd = addDays(date, fallbackGap);

  if (!nextIncome && windowEnd > config.endDate) {
    // Only refine using a detected recurring income series once the plain
    // medianGap estimate already reaches past known history — never let a
    // projection shrink or grow an otherwise-settled, fully-in-history
    // window just because a recurring series happens to exist.
    const projectedNext = ctx.projectedIncome
      .map((s) => nextOccurrenceAfter(s, date))
      .filter((d): d is ISODate => d !== null)
      .sort()[0];
    if (projectedNext) {
      windowEnd = addDays(date, daysBetween(date, projectedNext));
    }
  }

  const beyondHistory = windowEnd > config.endDate;
  const canProject = ctx.projectedOutflows.length > 0;
  if (beyondHistory && !canProject) {
    // Legacy previous-cycle proxy, retained as fallback: with nothing
    // detected, reuse the window one cycle back. Undercounts when the true
    // income gap exceeds 28 days (KNOWN_LIMITATIONS).
    windowStart = addDays(windowStart, -PROXY_SHIFT_DAYS);
    windowEnd = addDays(windowEnd, -PROXY_SHIFT_DAYS);
  }

  let nearTerm = 0;
  let essential = 0;
  const actualEnd = windowEnd > config.endDate ? config.endDate : windowEnd;
  for (const t of transactions) {
    if (t.direction !== "outflow" || !ctx.liquidIds.has(t.accountId)) continue;
    if (!(t.postedDate > windowStart && t.postedDate <= actualEnd)) continue;
    if (t.isTransfer) {
      const pair = t.transferPairId ? ctx.txnById.get(t.transferPairId) : undefined;
      if (pair && ctx.liabilityIds.has(pair.accountId)) nearTerm += t.amount; // debt payment
      continue;
    }
    nearTerm += t.amount;
    if (t.essential === true) essential += t.amount;
  }

  if (beyondHistory && canProject) {
    // Split window: actuals covered above up to endDate; recurring series
    // project their expected occurrences into (endDate, windowEnd].
    for (const s of ctx.projectedOutflows) {
      const count = occurrencesAfter(s, config.endDate, windowEnd).length;
      nearTerm += s.typicalAmount * count;
      if (s.essential) essential += s.typicalAmount * count;
    }
  }
  return { nearTerm, essential };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
