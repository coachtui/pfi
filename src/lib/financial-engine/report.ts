import type { DailySnapshot, FinancialEvent, IndexPoint, ISODate } from "./types";
import type { TransactionInput } from "./snapshot-builder";
import { formatDollars, formatSignedDollars } from "./format";

export type ReportGranularity = "monthly" | "quarterly";

export interface ReportPeriod {
  key: string;
  label: string;
  start: ISODate;
  end: ISODate;
  complete: boolean;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymd(date: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m1: number, d: number): ISODate {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Last calendar day of month m1 (1-based) in year y. */
function lastDayOfMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

export function enumeratePeriods(
  snapshots: DailySnapshot[],
  granularity: ReportGranularity,
): ReportPeriod[] {
  if (snapshots.length === 0) return [];
  const first = snapshots[0].date;
  const last = snapshots[snapshots.length - 1].date;
  const { y: fy, m: fm } = ymd(first);
  const { y: ly, m: lm } = ymd(last);
  const periods: ReportPeriod[] = [];

  if (granularity === "monthly") {
    let y = fy;
    let m = fm;
    while (y < ly || (y === ly && m <= lm)) {
      const start = iso(y, m, 1);
      const end = iso(y, m, lastDayOfMonth(y, m));
      periods.push({
        key: `${y}-M${String(m).padStart(2, "0")}`,
        label: `${MONTHS[m - 1]} ${y}`,
        start,
        end,
        complete: start >= first && end <= last,
      });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else {
    const lastQ = Math.floor((lm - 1) / 3);
    let y = fy;
    let q = Math.floor((fm - 1) / 3);
    while (y < ly || (y === ly && q <= lastQ)) {
      const startM = q * 3 + 1;
      const endM = q * 3 + 3;
      const start = iso(y, startM, 1);
      const end = iso(y, endM, lastDayOfMonth(y, endM));
      periods.push({
        key: `${y}-Q${q + 1}`,
        label: `Q${q + 1} ${y}`,
        start,
        end,
        complete: start >= first && end <= last,
      });
      q += 1;
      if (q > 3) { q = 0; y += 1; }
    }
  }
  return periods;
}

export function latestCompletePeriod(periods: ReportPeriod[]): ReportPeriod | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    if (periods[i].complete) return periods[i];
  }
  return periods[periods.length - 1] ?? null;
}

export interface PeriodStatement {
  period: ReportPeriod;
  revenue: number;
  operatingExpenses: number;
  freeCashFlow: number;
  savings: number;
  investments: number;
  debtReduction: number;
  ownerCreatedEquity: number;
  marketAppreciation: number;
  indexStart: number;
  indexEnd: number;
  indexChange: number;
  savingsRatePct: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lastWhere<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i];
  }
  return undefined;
}

/**
 * Deterministic shareholder-style statement for a period. Every figure traces
 * to transactions (revenue, operating expenses), investment_contribution events
 * (investments), or snapshot/index deltas (savings, debt reduction, index).
 * The identity freeCashFlow === ownerCreatedEquity holds exactly for the demo
 * dataset (zero market drift, static mortgage/property) — see the design spec.
 */
export function computePeriodStatement(
  snapshots: DailySnapshot[],
  transactions: TransactionInput[],
  events: FinancialEvent[],
  indexPoints: IndexPoint[],
  period: ReportPeriod,
): PeriodStatement {
  const { start, end } = period;

  const endSnap = lastWhere(snapshots, (s) => s.date <= end) ?? snapshots[0];
  const prevSnap = lastWhere(snapshots, (s) => s.date < start) ?? snapshots[0];

  // Transactions and events are windowed to (prevSnap.date, endSnap.date] —
  // the exact interval the snapshot delta below measures — rather than the
  // period's nominal [start, end]. For a normal period these coincide
  // (prevSnap sits on start-1, endSnap on end). For a "leading partial"
  // period (period.start predates the earliest snapshot), prevSnap falls
  // back to the earliest snapshot itself; that snapshot's balance already
  // reflects its own day's flows, so re-including that day's transactions
  // and events in the sums below would double count it against the
  // snapshot delta and break the freeCashFlow === ownerCreatedEquity
  // identity. Same logic applies symmetrically at the trailing edge, though
  // in practice no transactions exist past the last snapshot anyway.
  const windowStart = prevSnap?.date;
  const windowEnd = endSnap?.date;
  const inWindow = (date: ISODate): boolean =>
    windowStart !== undefined && windowEnd !== undefined && date > windowStart && date <= windowEnd;

  let revenue = 0;
  let operatingExpenses = 0;
  for (const t of transactions) {
    if (!inWindow(t.postedDate)) continue;
    if (t.direction === "inflow" && !t.isTransfer && t.category === "income") revenue += t.amount;
    if (t.direction === "outflow" && !t.isTransfer) operatingExpenses += t.amount;
  }

  let investments = 0;
  for (const e of events) {
    if (inWindow(e.date) && e.type === "investment_contribution") investments += e.amount;
  }

  const savings = prevSnap && endSnap ? endSnap.liquidAssets - prevSnap.liquidAssets : 0;
  const debtReduction = prevSnap && endSnap ? prevSnap.revolvingBalances - endSnap.revolvingBalances : 0;
  const ownerCreatedEquity = savings + investments + debtReduction;

  const indexByDate = new Map(indexPoints.map((p) => [p.date, p.actual]));
  const indexStart = prevSnap ? (indexByDate.get(prevSnap.date) ?? 100) : 100;
  const indexEnd = endSnap ? (indexByDate.get(endSnap.date) ?? indexStart) : indexStart;

  const freeCashFlow = revenue - operatingExpenses;
  const savingsRatePct = revenue > 0 ? round2((savings / revenue) * 100) : 0;

  return {
    period,
    revenue: round2(revenue),
    operatingExpenses: round2(operatingExpenses),
    freeCashFlow: round2(freeCashFlow),
    savings: round2(savings),
    investments: round2(investments),
    debtReduction: round2(debtReduction),
    ownerCreatedEquity: round2(ownerCreatedEquity),
    marketAppreciation: 0,
    indexStart: round2(indexStart),
    indexEnd: round2(indexEnd),
    indexChange: round2(indexEnd - indexStart),
    savingsRatePct,
  };
}

/**
 * Deterministic shareholder-letter commentary assembled only from the
 * statement's computed figures. No fabrication; the UI tags this
 * "Calculated · AI narration in Phase 4".
 */
export function buildManagementCommentary(statement: PeriodStatement, companyName: string): string[] {
  const s = statement;
  const fcfVerb = s.freeCashFlow >= 0 ? "produced" : "posted";
  const flowNoun = s.freeCashFlow >= 0 ? "surplus" : "shortfall";
  const equityVerb = s.ownerCreatedEquity >= 0
    ? `building ${formatDollars(s.ownerCreatedEquity)} of owner-created equity`
    : `reducing owner-created equity by ${formatDollars(Math.abs(s.ownerCreatedEquity))}`;
  const indexPhrase =
    s.indexChange > 0 ? `rose ${s.indexChange.toFixed(1)} points`
    : s.indexChange < 0 ? `fell ${Math.abs(s.indexChange).toFixed(1)} points`
    : "was unchanged";

  return [
    `During ${s.period.label}, ${companyName} recorded ${formatDollars(s.revenue)} of revenue against ${formatDollars(s.operatingExpenses)} of operating expenses, and ${fcfVerb} ${formatSignedDollars(s.freeCashFlow)} of free cash flow.`,
    `That ${flowNoun} was allocated across ${formatDollars(s.savings)} of retained cash, ${formatDollars(s.investments)} of investment contributions, and ${formatSignedDollars(s.debtReduction)} of debt reduction — ${equityVerb}, with no market appreciation recorded this period.`,
    `The personal index ${indexPhrase} over the period, ending at ${s.indexEnd.toFixed(1)}.`,
    `The household retained ${s.savingsRatePct.toFixed(1)}% of revenue as cash this period.`,
  ];
}
