import type { ISODate } from "./types";
import { essentialForCategory } from "./essential";
import {
  addDays, daysBetween, LIABILITY_TYPES, LIQUID_TYPES,
  type AccountInput, type TransactionInput,
} from "./snapshot-builder";

/**
 * Collapse a raw bank/CSV description into a stable grouping key: lowercase,
 * digit runs (reference codes, invoice numbers, dates) removed, punctuation
 * removed, whitespace collapsed. "NETFLIX.COM 4529" and "NETFLIX.COM 8817"
 * both normalize to "netflix com".
 */
export function normalizeDescription(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\d+[/\-.\d]*/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable identity for a recurring series: FNV-1a over account + direction +
 * normalized description ONLY. Cadence and amount are deliberately excluded
 * so a series that reclassifies as more data arrives keeps its key — and the
 * user's confirm/dismiss override keeps sticking to it.
 */
export function seriesKeyOf(
  accountId: string,
  direction: "inflow" | "outflow",
  normalizedDescription: string,
): string {
  const input = `${accountId}|${direction}|${normalizedDescription}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "annual";
export type RecurringConfidence = "high" | "medium" | "low";

export interface RecurringSeries {
  seriesKey: string;
  accountId: string;
  direction: "inflow" | "outflow";
  displayName: string;
  cadence: Cadence;
  intervalDays: number;
  typicalAmount: number;
  variableAmount: boolean;
  essential: boolean;
  isDebtPayment: boolean;
  isIncome: boolean;
  occurrenceCount: number;
  firstDate: ISODate;
  lastDate: ISODate;
  nextExpectedDate: ISODate;
  lapsed: boolean;
  confidence: RecurringConfidence;
}

export interface RecurringOverride {
  seriesKey: string;
  status: "confirmed" | "dismissed";
}

interface CadenceBucket {
  cadence: Cadence;
  min: number;
  max: number;
  intervalDays: number;
}

const BUCKETS: readonly CadenceBucket[] = [
  { cadence: "weekly", min: 5, max: 9, intervalDays: 7 },
  { cadence: "biweekly", min: 11, max: 17, intervalDays: 14 },
  { cadence: "monthly", min: 28, max: 33, intervalDays: 30 },
  { cadence: "quarterly", min: 85, max: 95, intervalDays: 91 },
  { cadence: "annual", min: 350, max: 380, intervalDays: 365 },
];
// Overlaps the biweekly band; distinguished by a ≤2-element day-of-month
// anchor set (e.g. paid on the 1st and the 15th), so it is checked first.
const SEMIMONTHLY: CadenceBucket = { cadence: "semimonthly", min: 13, max: 18, intervalDays: 15 };

const MIN_OCCURRENCES = 3;
const AMOUNT_TOLERANCE = 0.2;
const AMOUNT_QUALIFYING_SHARE = 0.75;
const VARIABLE_THRESHOLD = 0.05;
const LAPSED_FACTOR = 1.5;
const MAX_PROJECTION_STEPS = 400;

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classifyCadence(dates: ISODate[]): CadenceBucket | null {
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
  const m = medianOf(gaps);
  const daysOfMonth = new Set(dates.map((d) => Number(d.slice(8, 10))));
  if (
    m >= SEMIMONTHLY.min && m <= SEMIMONTHLY.max && daysOfMonth.size <= 2 &&
    gaps.every((g) => g >= SEMIMONTHLY.min && g <= SEMIMONTHLY.max)
  ) {
    return SEMIMONTHLY;
  }
  for (const b of BUCKETS) {
    if (m >= b.min && m <= b.max && gaps.every((g) => g >= b.min && g <= b.max)) return b;
  }
  return null;
}

function demote(c: RecurringConfidence): RecurringConfidence {
  return c === "high" ? "medium" : "low";
}

/**
 * Detect recurring transaction series. Pure and deterministic: same accounts,
 * transactions, and reference date always produce the same sorted output.
 * Candidates are transactions on liquid accounts; transfers are excluded
 * unless they are outflows paired into a liability account (debt payments).
 */
export function detectRecurringSeries(
  accounts: AccountInput[],
  transactions: TransactionInput[],
  referenceDate: ISODate,
): RecurringSeries[] {
  const liquidIds = new Set(accounts.filter((a) => LIQUID_TYPES.has(a.type)).map((a) => a.id));
  const liabilityIds = new Set(accounts.filter((a) => LIABILITY_TYPES.has(a.type)).map((a) => a.id));
  const txnById = new Map(transactions.map((t) => [t.id, t]));

  const groups = new Map<string, { accountId: string; direction: "inflow" | "outflow"; norm: string; txns: TransactionInput[] }>();
  for (const t of transactions) {
    if (!liquidIds.has(t.accountId)) continue;
    if (t.isTransfer) {
      const pair = t.transferPairId ? txnById.get(t.transferPairId) : undefined;
      if (!(t.direction === "outflow" && pair && liabilityIds.has(pair.accountId))) continue;
    }
    const norm = normalizeDescription(t.description);
    if (norm === "") continue;
    const key = `${t.accountId}|${t.direction}|${norm}`;
    const g = groups.get(key) ?? { accountId: t.accountId, direction: t.direction, norm, txns: [] };
    g.txns.push(t);
    groups.set(key, g);
  }

  const series: RecurringSeries[] = [];
  for (const g of groups.values()) {
    // One occurrence per date; same-day transactions merge (amounts summed).
    const byDate = new Map<ISODate, number>();
    for (const t of g.txns) byDate.set(t.postedDate, (byDate.get(t.postedDate) ?? 0) + t.amount);
    const dates = [...byDate.keys()].sort();
    if (dates.length < MIN_OCCURRENCES) continue;

    const bucket = classifyCadence(dates);
    if (!bucket) continue;

    const amounts = dates.map((d) => byDate.get(d)!);
    const typical = medianOf(amounts);
    if (typical <= 0) continue;
    const within = amounts.filter((a) => Math.abs(a - typical) <= typical * AMOUNT_TOLERANCE).length;
    if (within / amounts.length < AMOUNT_QUALIFYING_SHARE) continue;
    const variableAmount = amounts.some((a) => Math.abs(a - typical) > typical * VARIABLE_THRESHOLD);

    const essentialCount = g.txns.filter((t) => t.essential ?? essentialForCategory(t.category)).length;
    const incomeCount = g.txns.filter((t) => t.category === "income").length;
    const lastDate = dates[dates.length - 1];
    const base: RecurringConfidence = dates.length >= 6 ? "high" : dates.length >= 4 ? "medium" : "low";

    series.push({
      seriesKey: seriesKeyOf(g.accountId, g.direction, g.norm),
      accountId: g.accountId,
      direction: g.direction,
      displayName: g.norm,
      cadence: bucket.cadence,
      intervalDays: bucket.intervalDays,
      typicalAmount: round2(typical),
      variableAmount,
      essential: essentialCount * 2 > g.txns.length,
      isDebtPayment: g.txns.some((t) => t.isTransfer),
      isIncome: g.direction === "inflow" && incomeCount * 2 > g.txns.length,
      occurrenceCount: dates.length,
      firstDate: dates[0],
      lastDate,
      nextExpectedDate: addDays(lastDate, bucket.intervalDays),
      lapsed: daysBetween(lastDate, referenceDate) > bucket.intervalDays * LAPSED_FACTOR,
      confidence: variableAmount ? demote(base) : base,
    });
  }
  return series.sort((a, b) => (a.seriesKey < b.seriesKey ? -1 : a.seriesKey > b.seriesKey ? 1 : 0));
}

/** Projected occurrence dates in (afterExclusive, throughInclusive]. */
export function occurrencesAfter(
  series: RecurringSeries,
  afterExclusive: ISODate,
  throughInclusive: ISODate,
): ISODate[] {
  const out: ISODate[] = [];
  let d = series.nextExpectedDate;
  for (let i = 0; i < MAX_PROJECTION_STEPS && d <= throughInclusive; i++) {
    if (d > afterExclusive) out.push(d);
    d = addDays(d, series.intervalDays);
  }
  return out;
}

/** First projected occurrence strictly after `date`; overdue series roll forward. */
export function nextOccurrenceAfter(series: RecurringSeries, date: ISODate): ISODate | null {
  let d = series.nextExpectedDate;
  for (let i = 0; i < MAX_PROJECTION_STEPS; i++) {
    if (d > date) return d;
    d = addDays(d, series.intervalDays);
  }
  return null;
}
