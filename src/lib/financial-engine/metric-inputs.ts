/**
 * Assembles the MetricInputs bundle for the PFI score engine.
 * The only score module that knows raw row shapes. Framework-free.
 * Normative rules: docs/FINANCIAL_HEALTH_SCORE.md ("Data-inclusion policy").
 */
import type { DailySnapshot, ISODate } from "./types";
import { addDays, type AccountType } from "./snapshot-builder";
import { essentialForCategory } from "./essential";

export const WINDOW_DAYS = 90;
export const BUCKETS = 3;
const BUCKET_DAYS = WINDOW_DAYS / BUCKETS;

const INVESTMENT_TYPES: ReadonlySet<AccountType> = new Set(["brokerage", "retirement"]);
const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set([
  "credit_card", "mortgage", "auto_loan", "student_loan", "personal_loan", "other_liability",
]);
const REVOLVING_TYPES: ReadonlySet<AccountType> = new Set(["credit_card"]);
/**
 * Accounts held at a custodian (bank/brokerage/retirement provider) where
 * "concentration at one institution" is a meaningful risk. Excludes
 * non-custodial assets like `property`/`other_asset` — a house isn't
 * custodial risk, so it must never inflate institution-concentration shares.
 */
const CUSTODIAL_TYPES: ReadonlySet<AccountType> = new Set([
  "checking", "savings", "money_market", "brokerage", "retirement",
]);

export interface ScoreAccountInput {
  id: string;
  type: AccountType;
  institution: string | null;
  currentBalance: number;
  creditLimit: number | null;
  interestRate: number | null;
  includeInCalculations: boolean;
  provider: string;
}

/** Effective (override-applied) transaction; caller applies overrides. */
export interface ScoreTransactionInput {
  id: string;
  accountId: string;
  postedDate: ISODate;
  amount: number;
  direction: "inflow" | "outflow";
  category: string | null;
  essential: boolean | null;
  isTransfer: boolean;
  transferPairId: string | null;
  description: string;
}

export interface BucketFlow {
  /** 0 = oldest, BUCKETS-1 = most recent. */
  index: number;
  income: number;
  spending: number;
  essential: number;
  contributions: number;
  debtPayments: number;
}

export interface IncomeSource {
  source: string;
  total: number;
  bucketsSeen: number;
  recurring: boolean;
}

export interface MetricInputs {
  asOfDate: ISODate;
  windowStart: ISODate;
  /** Days from first snapshot to asOfDate, inclusive. 0 with no snapshots. */
  historyDays: number;
  buckets: BucketFlow[];
  totals: { income: number; spending: number; essential: number; contributions: number; debtPayments: number };
  incomeSources: IncomeSource[];
  recurringIncomeMonthlyAvg: number;
  /** Snapshot at (or latest before) asOfDate within the window. */
  snapshot: DailySnapshot | null;
  /** liquidAssets series inside the window, ascending by date. */
  liquidSeries: number[];
  revolvingStart: number | null;
  revolvingEnd: number | null;
  debtAccounts: Array<{ balance: number; rate: number | null }>;
  hasRevolvingAccounts: boolean;
  /** Sum of known credit-card limits; null when no card has a limit. */
  revolvingLimitTotal: number | null;
  /** Positive-asset-balance shares by institution, descending. [] when <2 included accounts. */
  institutionShares: number[];
  accountCount: number;
  dataQuality: {
    uncategorizedShare: number;
    demo: boolean;
    /** Share of in-window transfers on included accounts with no matched pair. 0 when no transfers. */
    unresolvedTransferShare: number;
    /** Share of included accounts whose provider is "manual" (vs demo/csv/live sync). */
    manualShare: number;
  };
}

function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function normalizeSource(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildMetricInputs(
  snapshots: DailySnapshot[],
  transactions: ScoreTransactionInput[],
  accounts: ScoreAccountInput[],
  asOfDate: ISODate,
): MetricInputs {
  const windowStart = addDays(asOfDate, -(WINDOW_DAYS - 1));
  const included = accounts.filter((a) => a.includeInCalculations);
  const byId = new Map(included.map((a) => [a.id, a]));

  const pastSnaps = snapshots.filter((s) => s.date <= asOfDate);
  const windowSnaps = pastSnaps.filter((s) => s.date >= windowStart);
  const historyDays = pastSnaps.length > 0 ? daysBetween(pastSnaps[0].date, asOfDate) + 1 : 0;

  const buckets: BucketFlow[] = Array.from({ length: BUCKETS }, (_, index) => ({
    index, income: 0, spending: 0, essential: 0, contributions: 0, debtPayments: 0,
  }));
  const bucketOf = (date: ISODate): BucketFlow => {
    const daysFromEnd = daysBetween(date, asOfDate); // 0..WINDOW_DAYS-1
    const index = BUCKETS - 1 - Math.min(Math.floor(daysFromEnd / BUCKET_DAYS), BUCKETS - 1);
    return buckets[index];
  };

  const sourceTotals = new Map<string, { total: number; bucketIdx: Set<number> }>();
  let uncategorized = 0;
  let flowCount = 0;

  const windowTxns = transactions.filter(
    (t) => t.postedDate >= windowStart && t.postedDate <= asOfDate && byId.has(t.accountId),
  );

  for (const t of windowTxns) {
    const account = byId.get(t.accountId)!;
    const bucket = bucketOf(t.postedDate);

    if (t.isTransfer) {
      // Purposeful transfers are detected from the receiving side so each
      // pair is counted exactly once (FINANCIAL_HEALTH_SCORE.md policy).
      if (t.direction === "inflow" && INVESTMENT_TYPES.has(account.type)) {
        bucket.contributions += t.amount;
      } else if (t.direction === "inflow" && LIABILITY_TYPES.has(account.type)) {
        bucket.debtPayments += t.amount;
      }
      continue;
    }

    flowCount += 1;
    if (t.category === null) uncategorized += 1;

    if (t.direction === "inflow") {
      if (t.category === "income") {
        bucket.income += t.amount;
        const source = normalizeSource(t.description) || "uncategorized income";
        const entry = sourceTotals.get(source) ?? { total: 0, bucketIdx: new Set<number>() };
        entry.total += t.amount;
        entry.bucketIdx.add(bucket.index);
        sourceTotals.set(source, entry);
      } else {
        bucket.spending -= t.amount; // refund/reimbursement nets against spending
      }
      continue;
    }

    // Non-transfer outflows.
    if (t.category === "savings") {
      bucket.contributions += t.amount; // saving, not spending
      continue;
    }
    if (t.category === "debt_payment") {
      bucket.debtPayments += t.amount; // also real spending (an obligation)
    }
    bucket.spending += t.amount;
    if (t.essential ?? essentialForCategory(t.category)) bucket.essential += t.amount;
  }

  const totals = buckets.reduce(
    (acc, b) => ({
      income: acc.income + b.income,
      spending: acc.spending + b.spending,
      essential: acc.essential + b.essential,
      contributions: acc.contributions + b.contributions,
      debtPayments: acc.debtPayments + b.debtPayments,
    }),
    { income: 0, spending: 0, essential: 0, contributions: 0, debtPayments: 0 },
  );

  const incomeSources: IncomeSource[] = [...sourceTotals.entries()]
    .map(([source, { total, bucketIdx }]) => ({
      source, total, bucketsSeen: bucketIdx.size, recurring: bucketIdx.size >= 2,
    }))
    .sort((a, b) => b.total - a.total);
  const recurringIncome = incomeSources.filter((s) => s.recurring).reduce((sum, s) => sum + s.total, 0);

  const custodialIncluded = included.filter((a) => CUSTODIAL_TYPES.has(a.type) && a.currentBalance > 0);
  const assetBalances = new Map<string, number>();
  let assetTotal = 0;
  for (const a of custodialIncluded) {
    const key = a.institution ?? "Unknown";
    assetBalances.set(key, (assetBalances.get(key) ?? 0) + a.currentBalance);
    assetTotal += a.currentBalance;
  }
  const institutionShares =
    custodialIncluded.length >= 2 && assetTotal > 0
      ? [...assetBalances.values()].map((v) => v / assetTotal).sort((a, b) => b - a)
      : [];

  const revolving = included.filter((a) => REVOLVING_TYPES.has(a.type));
  const limits = revolving.filter((a) => a.creditLimit !== null && a.creditLimit > 0);

  const windowTransfers = windowTxns.filter((t) => t.isTransfer);
  const unresolvedTransfers = windowTransfers.filter((t) => t.transferPairId === null);
  const unresolvedTransferShare = windowTransfers.length > 0 ? unresolvedTransfers.length / windowTransfers.length : 0;
  const manualShare = included.length > 0 ? included.filter((a) => a.provider === "manual").length / included.length : 0;

  return {
    asOfDate,
    windowStart,
    historyDays,
    buckets,
    totals,
    incomeSources,
    recurringIncomeMonthlyAvg: recurringIncome / BUCKETS,
    snapshot: windowSnaps.at(-1) ?? null,
    liquidSeries: windowSnaps.map((s) => s.liquidAssets),
    revolvingStart: windowSnaps[0]?.revolvingBalances ?? null,
    revolvingEnd: windowSnaps.at(-1)?.revolvingBalances ?? null,
    debtAccounts: included
      .filter((a) => LIABILITY_TYPES.has(a.type) && a.currentBalance > 0)
      .map((a) => ({ balance: a.currentBalance, rate: a.interestRate })),
    hasRevolvingAccounts: revolving.length > 0,
    revolvingLimitTotal: limits.length > 0 ? limits.reduce((sum, a) => sum + (a.creditLimit ?? 0), 0) : null,
    institutionShares,
    accountCount: included.length,
    dataQuality: {
      uncategorizedShare: flowCount > 0 ? uncategorized / flowCount : 0,
      demo: included.some((a) => a.provider === "demo"),
      unresolvedTransferShare,
      manualShare,
    },
  };
}
