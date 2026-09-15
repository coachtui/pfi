/**
 * Driver-event derivation (Plaid Slice 2, DECISIONS #44; rules in
 * docs/DRIVER_EVENTS.md). Pure and deterministic: the same inputs always
 * produce the same events. Events explain "what moved your line"; they never
 * feed snapshots or the score, so a wrong event is a wrong explanation, not a
 * wrong number — the rules are therefore conservative.
 *
 * Inputs are EFFECTIVE transactions (user overrides already applied) plus the
 * household's recurring series and, optionally, liability balance history.
 * Demo accounts are never derived (the demo loader authors its own events).
 *
 * Versioning: any rule change bumps EVENT_DERIVATION_VERSION and every
 * derived row is regenerated on the next rebuild.
 */
import { derivedBalanceAt, type BalanceAnchor } from "./anchors";
import { normalizeDescription, seriesKeyOf, type Cadence, type RecurringConfidence } from "./recurring";
import { LIABILITY_TYPES, LIQUID_TYPES, type AccountInput, type AccountType, type TransactionInput } from "./snapshot-builder";
import type { FinancialEventType, ISODate } from "./types";

export const EVENT_DERIVATION_VERSION = "v1";

/** Fixed floor for a one-off purchase to count as a driver, in dollars. */
export const LARGE_PURCHASE_FLOOR = 250;
/** Multiple of the household's trailing-90-day median one-off outflow. */
export const LARGE_PURCHASE_MULTIPLIER = 2.5;
/** Trailing window (days) for the relative threshold. */
export const THRESHOLD_WINDOW_DAYS = 90;
/** Minimum samples before the relative rule applies; below this the floor alone decides. */
export const THRESHOLD_MIN_SAMPLES = 5;
/** Per calendar month, per type, keep only the largest N one-off events. */
export const ONE_OFF_MONTHLY_CAP = 3;
/** Bonus: non-recurring income at least this multiple of the median paycheck, and at least this floor. */
export const BONUS_MULTIPLIER = 1.5;
export const BONUS_FLOOR = 500;

export interface EventAccountInput {
  id: string;
  type: AccountType;
  provider: string;
  includeInCalculations: boolean;
  archived: boolean;
}

export interface EventTransactionInput {
  id: string;
  accountId: string;
  postedDate: ISODate;
  amount: number;
  direction: "inflow" | "outflow";
  /** Effective category (override applied). */
  category: string | null;
  isTransfer: boolean;
  transferPairId: string | null;
  /** Source description: series keys and confirm/dismiss statuses are keyed on it, so it must match what the Recurring page detected. */
  description: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
}

/** The subset of a RecurringSeries the rules need, plus the user's confirm/dismiss status. */
export interface EventSeriesInput {
  seriesKey: string;
  displayName: string;
  cadence: Cadence;
  typicalAmount: number;
  occurrenceCount: number;
  confidence: RecurringConfidence;
  isIncome: boolean;
  status: "confirmed" | "dismissed" | null;
}

/** A (date, balance) point for a liability account; used only for debt_payoff. */
export interface LiabilityBalancePoint {
  accountId: string;
  date: ISODate;
  balance: number;
}

export interface DerivedEvent {
  transactionId: string;
  date: ISODate;
  type: FinancialEventType;
  label: string;
  amount: number;
  direction: "inflow" | "outflow";
}

export interface DeriveEventsInput {
  accounts: EventAccountInput[];
  transactions: EventTransactionInput[];
  series: EventSeriesInput[];
  liabilityBalances?: LiabilityBalancePoint[];
}

const PAYCHECK_CADENCES: ReadonlySet<Cadence> = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);
const PAYCHECK_DETAILS: ReadonlySet<string> = new Set(["INCOME_SALARY", "INCOME_WAGES"]);
const INVESTMENT_TYPES: ReadonlySet<AccountType> = new Set(["brokerage", "retirement"]);
const SPENDING_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set([...LIQUID_TYPES, "credit_card"]);
const LARGE_PURCHASE_CATEGORIES: ReadonlySet<string> = new Set(["shopping", "discretionary", "transport", "other"]);
const UNEXPECTED_CATEGORIES: ReadonlySet<string> = new Set(["health", "housing"]);
const UNEXPECTED_DETAILS: ReadonlySet<string> = new Set(["HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE", "GENERAL_SERVICES_AUTOMOTIVE"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function seriesEligible(s: EventSeriesInput): boolean {
  if (s.status === "dismissed") return false;
  if (s.status === "confirmed") return true;
  return s.occurrenceCount >= 3 && (s.confidence === "high" || s.confidence === "medium");
}

/**
 * A liability account's balance at the anchor date and at every date it had a
 * transaction, derived from its effective anchor (direction-agnostic, so dates
 * before the anchor are covered too). Positive means owed. Feeds debt_payoff.
 */
export function liabilityBalanceHistory(
  account: AccountInput,
  anchor: Pick<BalanceAnchor, "balance" | "anchorDate">,
  transactions: TransactionInput[],
): LiabilityBalancePoint[] {
  const dates = new Set<ISODate>([anchor.anchorDate]);
  for (const t of transactions) if (t.accountId === account.id) dates.add(t.postedDate);
  return [...dates].sort().map((date) => ({ accountId: account.id, date, balance: derivedBalanceAt(account, anchor, date, transactions) }));
}

/** The one-off purchase bar for a transaction: max(floor, multiplier × trailing-window median of one-off outflows). */
export function oneOffThreshold(windowSamples: number[]): number {
  if (windowSamples.length < THRESHOLD_MIN_SAMPLES) return LARGE_PURCHASE_FLOOR;
  return Math.max(LARGE_PURCHASE_FLOOR, round2(LARGE_PURCHASE_MULTIPLIER * median(windowSamples)));
}

export function deriveEvents(input: DeriveEventsInput): DerivedEvent[] {
  const eligibleAccounts = new Map(
    input.accounts
      .filter((a) => a.provider !== "demo" && a.includeInCalculations && !a.archived)
      .map((a) => [a.id, a]),
  );
  const accountType = (id: string): AccountType | null => eligibleAccounts.get(id)?.type ?? input.accounts.find((a) => a.id === id)?.type ?? null;
  const txns = input.transactions
    .filter((t) => eligibleAccounts.has(t.accountId))
    .sort((a, b) => (a.postedDate < b.postedDate ? -1 : a.postedDate > b.postedDate ? 1 : a.id < b.id ? -1 : 1));
  const txnById = new Map(input.transactions.map((t) => [t.id, t]));

  const seriesByKey = new Map(input.series.filter(seriesEligible).map((s) => [s.seriesKey, s]));
  const seriesFor = (t: EventTransactionInput): EventSeriesInput | null =>
    seriesByKey.get(seriesKeyOf(t.accountId, t.direction, normalizeDescription(t.description))) ?? null;
  const paycheckSeries = [...seriesByKey.values()].filter((s) => s.isIncome && PAYCHECK_CADENCES.has(s.cadence));
  const bonusBar = paycheckSeries.length > 0
    ? Math.max(BONUS_FLOOR, round2(BONUS_MULTIPLIER * median(paycheckSeries.map((s) => s.typicalAmount))))
    : null;

  // One-off outflows (non-transfer, not a series occurrence, spending accounts) feed the relative threshold.
  const oneOffOutflows = txns.filter(
    (t) => t.direction === "outflow" && !t.isTransfer && !seriesFor(t) && SPENDING_ACCOUNT_TYPES.has(accountType(t.accountId) as AccountType),
  );
  const windowSamplesBefore = (date: ISODate): number[] => {
    const start = addDays(date, -(THRESHOLD_WINDOW_DAYS - 1));
    return oneOffOutflows.filter((o) => o.postedDate >= start && o.postedDate < date).map((o) => o.amount);
  };

  // Liability balance history for debt_payoff, per account, date-sorted.
  const balancesByAccount = new Map<string, LiabilityBalancePoint[]>();
  for (const p of input.liabilityBalances ?? []) {
    balancesByAccount.set(p.accountId, [...(balancesByAccount.get(p.accountId) ?? []), p]);
  }
  for (const list of balancesByAccount.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1));
  // Payoff needs history that actually covers the payment date: a balance
  // series that starts later says nothing about what happened in between.
  const paidOffAfter = (accountId: string, date: ISODate): boolean => {
    const points = balancesByAccount.get(accountId) ?? [];
    if (points.length === 0 || points[0].date > date) return false;
    const after = points.filter((p) => p.date >= date);
    return after.length > 0 && after.every((p) => p.balance <= 0);
  };

  const counterpartType = (t: EventTransactionInput): AccountType | null => {
    if (!t.isTransfer || !t.transferPairId) return null;
    const other = txnById.get(t.transferPairId);
    return other ? accountType(other.accountId) : null;
  };

  const events: DerivedEvent[] = [];
  const oneOff: DerivedEvent[] = [];
  const push = (t: EventTransactionInput, type: FinancialEventType, label: string, bucket: DerivedEvent[] = events) =>
    bucket.push({ transactionId: t.id, date: t.postedDate, type, label, amount: round2(t.amount), direction: t.direction });

  for (const t of txns) {
    const series = seriesFor(t);
    const acctType = accountType(t.accountId) as AccountType;

    if (t.direction === "inflow") {
      if (!LIQUID_TYPES.has(acctType)) continue;
      const isPaycheckSeries = series !== null && series.isIncome && PAYCHECK_CADENCES.has(series.cadence);
      if (isPaycheckSeries || (t.pfcDetailed !== null && PAYCHECK_DETAILS.has(t.pfcDetailed))) {
        push(t, "paycheck", series ? titleCase(series.displayName) : t.description);
        continue;
      }
      // Bonus: an occurrence of a recurring income series at a non-paycheck cadence (e.g. a
      // quarterly bonus), or a one-off income inflow that clears the bonus bar.
      const isBonusSeries = series !== null && series.isIncome && !PAYCHECK_CADENCES.has(series.cadence);
      if (isBonusSeries) {
        push(t, "bonus", titleCase(series.displayName));
      } else if (series === null && t.category === "income" && bonusBar !== null && t.amount >= bonusBar) {
        push(t, "bonus", t.description);
      }
      continue;
    }

    // Outflows
    const cpType = counterpartType(t);
    if (t.pfcDetailed === "LOAN_PAYMENTS_MORTGAGE_PAYMENT" || cpType === "mortgage" ||
        (series !== null && t.category === "housing" && /mortgage/.test(series.displayName))) {
      push(t, "mortgage_payment", series ? titleCase(series.displayName) : t.description);
      continue;
    }
    if ((cpType !== null && INVESTMENT_TYPES.has(cpType)) || (!t.isTransfer && t.pfcDetailed === "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS")) {
      push(t, "investment_contribution", t.description);
      continue;
    }
    if ((cpType !== null && LIABILITY_TYPES.has(cpType)) || (!t.isTransfer && t.pfcPrimary === "LOAN_PAYMENTS")) {
      const other = t.transferPairId ? txnById.get(t.transferPairId) : undefined;
      const payoff = other ? paidOffAfter(other.accountId, t.postedDate) : false;
      push(t, payoff ? "debt_payoff" : "debt_payment", t.description);
      continue;
    }
    if (t.pfcDetailed === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT") {
      push(t, "tax_payment", t.description);
      continue;
    }
    if (t.category === "insurance" && series !== null) {
      push(t, "insurance_payment", titleCase(series.displayName));
      continue;
    }
    if (t.isTransfer || series !== null || !SPENDING_ACCOUNT_TYPES.has(acctType)) continue;

    const unexpected = (t.category !== null && UNEXPECTED_CATEGORIES.has(t.category))
      || (t.pfcDetailed !== null && UNEXPECTED_DETAILS.has(t.pfcDetailed))
      || t.pfcPrimary === "MEDICAL";
    const large = t.category !== null && LARGE_PURCHASE_CATEGORIES.has(t.category);
    if (!unexpected && !large) continue;
    if (t.amount < oneOffThreshold(windowSamplesBefore(t.postedDate))) continue;
    push(t, unexpected ? "unexpected_expense" : "large_purchase", t.description, oneOff);
  }

  // Monthly cap for one-off types: keep the largest N per (type, month).
  const byBucket = new Map<string, DerivedEvent[]>();
  for (const e of oneOff) {
    const key = `${e.type}|${e.date.slice(0, 7)}`;
    byBucket.set(key, [...(byBucket.get(key) ?? []), e]);
  }
  for (const list of byBucket.values()) {
    list.sort((a, b) => b.amount - a.amount || (a.date < b.date ? -1 : 1));
    events.push(...list.slice(0, ONE_OFF_MONTHLY_CAP));
  }

  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : a.transactionId < b.transactionId ? -1 : 1));
}
