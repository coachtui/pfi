# Phase 2 Financial Engine (PFI Score v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the PFI Score v1 — metric registry, six weighted dimensions, 0–900 versioned score with eligibility/renormalization missing-data policy, per-dimension confidence, Momentum overlay, score-delta explanations — surfaced as a dashboard score card and a `/score` screen.

**Architecture:** Pure, framework-free engine modules in `src/lib/financial-engine/` (inputs bundle → metric registry → confidence → scoring → momentum/delta), consumed by a server-only `getScoreData` query and rendered by a `/score` screen + dashboard card. Scores compute at read time; no migrations.

**Tech Stack:** TypeScript strict, Vitest (colocated `*.test.ts`), Next.js 16 App Router, Tailwind 4 tokens, Supabase JS (server-only data layer). pnpm.

## Global Constraints

- `docs/FINANCIAL_HEALTH_SCORE.md` (v1.0) is **normative** — weights, curves, eligibility, edge cases must match it exactly. If implementation reveals a spec bug, update the spec in the same commit and say so in the commit message.
- `src/lib/financial-engine/**` must stay free of React/Next/Supabase imports (extraction rule).
- Never describe the score as a credit score. No shame language in copy. Never color-only state signaling (pair with sign/shape/text).
- User-facing copy uses consumer terms: "monthly surplus margin", "emergency runway", "debt burden", "interest drag", "contribution progress", "concentration risk", "score confidence". No "FCF", no "owner-created equity" in score UI.
- Every task: run the named tests before and after implementation; commit at the end of the task. Run `pnpm test` (offline suite) before each commit.
- `PFI_SCORE_VERSION = "1.0"`. Dimension weights: cash_flow 0.25, liquidity 0.20, debt 0.20, stability 0.15, growth 0.15, concentration 0.05 (sum = 1.0).
- Existing helpers to reuse, never duplicate: `addDays` (`snapshot-builder.ts`), `applyOverride`/`parseOverride` (`overrides.ts`), `Segmented` (`src/components/ui/Segmented.tsx`), `Card` (`src/components/ui/Card.tsx`).

## File Structure

```
src/lib/financial-engine/
  score-types.ts          (Task 1)  shared score result types + PFI_SCORE_VERSION
  metric-inputs.ts        (Task 1)  MetricInputs bundle + buildMetricInputs
  metric-inputs.test.ts   (Task 1)
  metrics.ts              (Task 2)  metric registry + computeMetrics
  metrics.test.ts         (Task 2)
  scoring.ts              (Task 3)  curves, dimensions, computeScore
  scoring.test.ts         (Task 3)
  confidence.ts           (Task 4)  per-dimension confidence report
  confidence.test.ts      (Task 4)
  momentum-overlay.ts     (Task 5)  momentum state machine
  momentum-overlay.test.ts(Task 5)
  score-delta.ts          (Task 6)  breakdown diff + integration test fixture
  score-delta.test.ts     (Task 6)
  score-pipeline.test.ts  (Task 6)  end-to-end engine test on synthetic fixture
  index.ts                (Task 6)  add new exports
src/lib/data/
  queries.ts              (Task 7)  + getScoreData, + score summary in getDashboardData
src/app/score/
  page.tsx                (Task 8)  server page
  ScoreView.tsx           (Task 8)  client view (range picker, dimensions, delta)
src/components/dashboard/
  ScoreCard.tsx           (Task 9)  dashboard card
  HomeDashboard.tsx       (Task 9)  wire card in
src/app/report/ReportView.tsx (Task 10) consumer-language relabel
docs/…                    (Task 10) CURRENT_PHASE, README
```

Every engine file: one responsibility, colocated test, no framework imports.

---

### Task 1: `score-types.ts` + `metric-inputs.ts`

**Files:**
- Create: `src/lib/financial-engine/score-types.ts`
- Create: `src/lib/financial-engine/metric-inputs.ts`
- Test: `src/lib/financial-engine/metric-inputs.test.ts`

**Interfaces:**
- Consumes: `ISODate`, `DailySnapshot` from `./types`; `addDays`, `AccountType` from `./snapshot-builder`.
- Produces: `PFI_SCORE_VERSION`, `DimensionKey`, `ConfidenceLevel`, `MetricAvailability`, `MetricResult`, `DimensionResult`, `OverallState`, `ScoreBreakdown`, `MomentumState`, `ScoreDelta`, `DimensionDelta`, `MetricMover` (score-types.ts); `WINDOW_DAYS`, `BUCKETS`, `ScoreAccountInput`, `ScoreTransactionInput`, `BucketFlow`, `MetricInputs`, `buildMetricInputs(snapshots, transactions, accounts, asOfDate)` (metric-inputs.ts). Later tasks rely on these exact names.

- [ ] **Step 1: Write `score-types.ts`** (types only — no test file needed; it is exercised by every later test)

```ts
import type { ISODate } from "./types";

export const PFI_SCORE_VERSION = "1.0";

export type DimensionKey =
  | "cash_flow" | "liquidity" | "debt" | "stability" | "growth" | "concentration";

export type ConfidenceLevel = "high" | "moderate" | "limited";
export type MetricAvailability = "available" | "unavailable" | "not_applicable";

export interface MetricResult {
  id: string;
  /** Plain-language, consumer-facing name. */
  name: string;
  dimension: DimensionKey;
  /** false = explanation-only: never affects any score. */
  scored: boolean;
  availability: MetricAvailability;
  /** Raw metric value (ratio, months, CV…); null unless available. */
  value: number | null;
  formatted: string | null;
  /** 0–100 curve score; null unless scored and available. */
  curveScore: number | null;
  definition: string;
  assumptions: string[];
  limitations: string[];
  /** Why unavailable / not applicable; null when available. */
  reason: string | null;
}

export interface DimensionResult {
  key: DimensionKey;
  label: string;
  configuredWeight: number;
  eligible: boolean;
  exclusionReason: string | null;
  /** 0–100; null when ineligible — never a fabricated number. */
  score: number | null;
  confidence: ConfidenceLevel | "insufficient_data";
  confidenceReasons: string[];
  metrics: MetricResult[];
}

export type OverallState = "full" | "provisional" | "suppressed";
export type ProtectionStatus =
  | "not_assessed" | "limited_data" | "needs_review" | "adequately_documented";

export interface ScoreBreakdown {
  version: string;
  asOfDate: ISODate;
  state: OverallState;
  /** 0–900; null when suppressed. */
  overall: number | null;
  band: string | null;
  overallConfidence: ConfidenceLevel | "insufficient_data";
  configuredWeights: Record<DimensionKey, number>;
  /** Renormalized over eligible dimensions; empty when suppressed. */
  effectiveWeights: Partial<Record<DimensionKey, number>>;
  dimensions: DimensionResult[];
  protection: { status: ProtectionStatus; includedInScore: false };
  /** Provisional/suppression explanations + improvement list. */
  notes: string[];
}

export type MomentumState =
  | "strongly_improving" | "improving" | "stable" | "weakening"
  | "deteriorating" | "recovering" | "insufficient_history";

export interface DimensionDelta {
  key: DimensionKey; label: string;
  from: number | null; to: number | null; change: number | null;
}
export interface MetricMover {
  id: string; name: string; dimension: DimensionKey;
  /** Signed contribution to the 0–900 overall change. */
  overallPointsImpact: number;
}
export interface ScoreDelta {
  state: "ok" | "insufficient_history";
  from: number | null; to: number | null; change: number | null;
  dimensions: DimensionDelta[];
  topMovers: MetricMover[];
  notes: string[];
}
```

- [ ] **Step 2: Write the failing tests for `buildMetricInputs`**

`src/lib/financial-engine/metric-inputs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DailySnapshot } from "./types";
import {
  buildMetricInputs, WINDOW_DAYS,
  type ScoreAccountInput, type ScoreTransactionInput,
} from "./metric-inputs";

const AS_OF = "2026-07-15";

const ACCOUNTS: ScoreAccountInput[] = [
  { id: "chk", type: "checking", institution: "First Bank", currentBalance: 8000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "demo" },
  { id: "sav", type: "savings", institution: "Ally", currentBalance: 12000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "demo" },
  { id: "card", type: "credit_card", institution: "First Bank", currentBalance: 2000, creditLimit: 10000, interestRate: 0.24, includeInCalculations: true, provider: "demo" },
  { id: "brk", type: "brokerage", institution: "Vanguard", currentBalance: 30000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "demo" },
];

function txn(partial: Partial<ScoreTransactionInput> & Pick<ScoreTransactionInput, "id" | "postedDate" | "amount" | "direction">): ScoreTransactionInput {
  return {
    accountId: "chk", category: null, essential: null, isTransfer: false,
    transferPairId: null, description: "", ...partial,
  };
}

function snap(date: string, liquid: number, revolving = 2000): DailySnapshot {
  return {
    date, liquidAssets: liquid, revolvingBalances: revolving,
    nearTermObligations: 3000, essentialObligations: 2000,
    safetyBuffer: 1000, netWorth: 40000,
  };
}

describe("buildMetricInputs", () => {
  it("classifies income, spending, refunds, and excludes plain transfers", () => {
    const inputs = buildMetricInputs(
      [snap("2026-07-14", 19000), snap(AS_OF, 20000)],
      [
        txn({ id: "t1", postedDate: "2026-07-01", amount: 3000, direction: "inflow", category: "income", description: "Employer payroll" }),
        txn({ id: "t2", postedDate: "2026-07-02", amount: 500, direction: "outflow", category: "groceries", essential: true }),
        txn({ id: "t3", postedDate: "2026-07-03", amount: 100, direction: "inflow", category: "shopping", description: "Refund" }), // refund nets spending
        txn({ id: "t4", postedDate: "2026-07-04", amount: 900, direction: "outflow", isTransfer: true, transferPairId: "t5" }),
        txn({ id: "t5", postedDate: "2026-07-04", amount: 900, direction: "inflow", accountId: "sav", isTransfer: true, transferPairId: "t4" }),
      ],
      ACCOUNTS, AS_OF,
    );
    expect(inputs.totals.income).toBe(3000);
    expect(inputs.totals.spending).toBe(400); // 500 - 100 refund; transfer excluded
    expect(inputs.totals.essential).toBe(500);
  });

  it("detects contributions and debt payments from transfer destinations and categories", () => {
    const inputs = buildMetricInputs(
      [snap(AS_OF, 20000)],
      [
        txn({ id: "t1", postedDate: "2026-07-01", amount: 3000, direction: "inflow", category: "income", description: "Employer payroll" }),
        // transfer pair into brokerage → contribution (counted once, from the inflow side)
        txn({ id: "o1", postedDate: "2026-07-05", amount: 500, direction: "outflow", isTransfer: true, transferPairId: "i1" }),
        txn({ id: "i1", postedDate: "2026-07-05", amount: 500, direction: "inflow", accountId: "brk", isTransfer: true, transferPairId: "o1" }),
        // transfer pair into credit card → debt payment
        txn({ id: "o2", postedDate: "2026-07-06", amount: 600, direction: "outflow", isTransfer: true, transferPairId: "i2" }),
        txn({ id: "i2", postedDate: "2026-07-06", amount: 600, direction: "inflow", accountId: "card", isTransfer: true, transferPairId: "o2" }),
        // categorized fallbacks
        txn({ id: "t2", postedDate: "2026-07-07", amount: 200, direction: "outflow", category: "savings" }),
        txn({ id: "t3", postedDate: "2026-07-08", amount: 300, direction: "outflow", category: "debt_payment" }),
      ],
      ACCOUNTS, AS_OF,
    );
    expect(inputs.totals.contributions).toBe(700); // 500 transfer + 200 categorized
    expect(inputs.totals.debtPayments).toBe(900);  // 600 transfer + 300 categorized
    // categorized debt payment is also ordinary spending (an obligation); savings category is not
    expect(inputs.totals.spending).toBe(300);
  });

  it("buckets flows into three 30-day buckets ending at asOf", () => {
    const inputs = buildMetricInputs(
      [snap(AS_OF, 20000)],
      [
        txn({ id: "a", postedDate: "2026-07-10", amount: 100, direction: "outflow", category: "dining" }),  // bucket 2 (most recent)
        txn({ id: "b", postedDate: "2026-06-01", amount: 100, direction: "outflow", category: "dining" }),  // bucket 1
        txn({ id: "c", postedDate: "2026-04-20", amount: 100, direction: "outflow", category: "dining" }),  // bucket 0 (oldest)
        txn({ id: "d", postedDate: "2026-04-01", amount: 999, direction: "outflow", category: "dining" }),  // outside window → dropped
      ],
      ACCOUNTS, AS_OF,
    );
    expect(inputs.buckets).toHaveLength(3);
    expect(inputs.buckets.map((b) => b.spending)).toEqual([100, 100, 100]);
  });

  it("groups income sources and flags recurring ones (seen in ≥2 buckets)", () => {
    const inputs = buildMetricInputs(
      [snap(AS_OF, 20000)],
      [
        txn({ id: "p1", postedDate: "2026-05-01", amount: 3000, direction: "inflow", category: "income", description: "Employer Payroll" }),
        txn({ id: "p2", postedDate: "2026-06-01", amount: 3000, direction: "inflow", category: "income", description: "employer payroll " }),
        txn({ id: "b1", postedDate: "2026-07-01", amount: 2000, direction: "inflow", category: "income", description: "Quarterly bonus" }),
      ],
      ACCOUNTS, AS_OF,
    );
    const payroll = inputs.incomeSources.find((s) => s.source === "employer payroll");
    expect(payroll).toMatchObject({ total: 6000, recurring: true });
    expect(inputs.incomeSources.find((s) => s.source === "quarterly bonus")).toMatchObject({ recurring: false });
    expect(inputs.recurringIncomeMonthlyAvg).toBe(2000); // 6000 / 3 buckets
  });

  it("computes institution shares over positive asset balances and debt account list", () => {
    const inputs = buildMetricInputs([snap(AS_OF, 20000)], [], ACCOUNTS, AS_OF);
    // assets: chk 8000 (First Bank) + sav 12000 (Ally) + brk 30000 (Vanguard) = 50000
    expect(inputs.institutionShares[0]).toBeCloseTo(0.6); // Vanguard
    expect(inputs.debtAccounts).toEqual([{ balance: 2000, rate: 0.24 }]);
    expect(inputs.revolvingLimitTotal).toBe(10000);
  });

  it("respects includeInCalculations, tracks history and demo flag", () => {
    const excluded = ACCOUNTS.map((a) => a.id === "brk" ? { ...a, includeInCalculations: false } : a);
    const inputs = buildMetricInputs(
      [snap("2026-06-01", 100), snap(AS_OF, 20000)],
      [txn({ id: "i1", postedDate: "2026-07-05", amount: 500, direction: "inflow", accountId: "brk", isTransfer: true, transferPairId: "x" })],
      excluded, AS_OF,
    );
    expect(inputs.totals.contributions).toBe(0); // excluded account's inflow ignored
    expect(inputs.institutionShares).toHaveLength(2); // Vanguard (excluded) no longer counted
    expect(inputs.historyDays).toBe(45); // 2026-06-01 → 2026-07-15 inclusive
    expect(inputs.dataQuality.demo).toBe(true);
    expect(inputs.snapshot?.liquidAssets).toBe(20000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/metric-inputs.test.ts`
Expected: FAIL — `Cannot find module './metric-inputs'`.

- [ ] **Step 4: Implement `metric-inputs.ts`**

```ts
/**
 * Assembles the MetricInputs bundle for the PFI score engine.
 * The only score module that knows raw row shapes. Framework-free.
 * Normative rules: docs/FINANCIAL_HEALTH_SCORE.md ("Data-inclusion policy").
 */
import type { DailySnapshot, ISODate } from "./types";
import { addDays, type AccountType } from "./snapshot-builder";

export const WINDOW_DAYS = 90;
export const BUCKETS = 3;
const BUCKET_DAYS = WINDOW_DAYS / BUCKETS;

const INVESTMENT_TYPES: ReadonlySet<AccountType> = new Set(["brokerage", "retirement"]);
const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set([
  "credit_card", "mortgage", "auto_loan", "student_loan", "personal_loan", "other_liability",
]);
const REVOLVING_TYPES: ReadonlySet<AccountType> = new Set(["credit_card"]);
const ASSET_TYPES: ReadonlySet<AccountType> = new Set([
  "checking", "savings", "money_market", "brokerage", "retirement", "property", "other_asset",
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
  dataQuality: { uncategorizedShare: number; demo: boolean };
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
    if (t.essential === true) bucket.essential += t.amount;
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

  const assetBalances = new Map<string, number>();
  let assetTotal = 0;
  for (const a of included) {
    if (ASSET_TYPES.has(a.type) && a.currentBalance > 0) {
      const key = a.institution ?? "Unknown";
      assetBalances.set(key, (assetBalances.get(key) ?? 0) + a.currentBalance);
      assetTotal += a.currentBalance;
    }
  }
  const institutionShares =
    included.length >= 2 && assetTotal > 0
      ? [...assetBalances.values()].map((v) => v / assetTotal).sort((a, b) => b - a)
      : [];

  const revolving = included.filter((a) => REVOLVING_TYPES.has(a.type));
  const limits = revolving.filter((a) => a.creditLimit !== null && a.creditLimit > 0);

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
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/metric-inputs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/financial-engine/score-types.ts src/lib/financial-engine/metric-inputs.ts src/lib/financial-engine/metric-inputs.test.ts
git commit -m "feat(engine): score types and MetricInputs bundle for PFI score v1"
```

---

### Task 2: `metrics.ts` — the metric registry

**Files:**
- Create: `src/lib/financial-engine/metrics.ts`
- Test: `src/lib/financial-engine/metrics.test.ts`

**Interfaces:**
- Consumes: `MetricInputs`, `WINDOW_DAYS`, `BUCKETS` from `./metric-inputs`; `MetricResult`, `DimensionKey` from `./score-types`.
- Produces: `METRICS: MetricDef[]`, `computeMetrics(inputs: MetricInputs): MetricResult[]`, `type MetricDef`, `type MetricComputation`. Metric ids (exact, all scored): `net_cash_flow_margin`, `fixed_cost_ratio`, `expense_volatility`, `liquid_runway_months`, `obligation_coverage`, `cash_drawdown`, `debt_service_ratio`, `revolving_utilization`, `weighted_interest_burden`, `revolving_trajectory`, `income_consistency`, `recurring_income_coverage`, `irregular_income_reliance`, `contribution_rate`, `contribution_consistency`, `institution_concentration`, `income_source_concentration`; explanation-only id: `recurring_surplus`.

- [ ] **Step 1: Write the failing tests**

`src/lib/financial-engine/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMetricInputs, type MetricInputs, type ScoreAccountInput, type ScoreTransactionInput } from "./metric-inputs";
import { METRICS, computeMetrics } from "./metrics";
import type { DailySnapshot } from "./types";

const AS_OF = "2026-07-15";

const ACCOUNTS: ScoreAccountInput[] = [
  { id: "chk", type: "checking", institution: "First Bank", currentBalance: 9000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "sav", type: "savings", institution: "Ally", currentBalance: 6000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "card", type: "credit_card", institution: "First Bank", currentBalance: 3000, creditLimit: 10000, interestRate: 0.24, includeInCalculations: true, provider: "manual" },
];

function snap(date: string, liquid: number, revolving = 3000): DailySnapshot {
  return { date, liquidAssets: liquid, revolvingBalances: revolving, nearTermObligations: 3000, essentialObligations: 2000, safetyBuffer: 1000, netWorth: 12000 };
}

/** ~4 months of history: monthly payroll, rent, groceries, card payment. */
function healthyFixture(): { snapshots: DailySnapshot[]; txns: ScoreTransactionInput[] } {
  const txns: ScoreTransactionInput[] = [];
  const snapshots: DailySnapshot[] = [];
  const base = { accountId: "chk", category: null as string | null, essential: null as boolean | null, isTransfer: false, transferPairId: null, description: "" };
  const months = ["2026-04", "2026-05", "2026-06", "2026-07"];
  months.forEach((m, i) => {
    txns.push({ ...base, id: `pay${i}`, postedDate: `${m}-01`, amount: 6000, direction: "inflow", category: "income", description: "Employer payroll" });
    txns.push({ ...base, id: `rent${i}`, postedDate: `${m}-02`, amount: 1800, direction: "outflow", category: "housing", essential: true });
    txns.push({ ...base, id: `gro${i}`, postedDate: `${m}-10`, amount: 700, direction: "outflow", category: "groceries", essential: true });
    txns.push({ ...base, id: `fun${i}`, postedDate: `${m}-12`, amount: 500, direction: "outflow", category: "discretionary", essential: false });
    txns.push({ ...base, id: `dpo${i}`, postedDate: `${m}-15`, amount: 400, direction: "outflow", isTransfer: true, transferPairId: `dpi${i}` });
    txns.push({ ...base, id: `dpi${i}`, postedDate: `${m}-15`, amount: 400, direction: "inflow", accountId: "card", isTransfer: true, transferPairId: `dpo${i}` });
  });
  for (let d = 0; d < 106; d++) {
    const date = new Date(Date.UTC(2026, 3, 1 + d)).toISOString().slice(0, 10);
    if (date > AS_OF) break;
    snapshots.push(snap(date, 12000 + d * 20));
  }
  return { snapshots, txns };
}

function inputsFor(overrides?: { accounts?: ScoreAccountInput[]; txns?: ScoreTransactionInput[] }): MetricInputs {
  const fx = healthyFixture();
  return buildMetricInputs(fx.snapshots, overrides?.txns ?? fx.txns, overrides?.accounts ?? ACCOUNTS, AS_OF);
}

describe("METRICS registry", () => {
  it("has 17 scored metrics with valid dimensions and required documentation", () => {
    const scored = METRICS.filter((m) => m.scored);
    expect(scored).toHaveLength(17);
    for (const m of METRICS) {
      expect(m.definition.length).toBeGreaterThan(10);
      expect(["cash_flow", "liquidity", "debt", "stability", "growth", "concentration"]).toContain(m.dimension);
    }
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
  });
});

describe("computeMetrics", () => {
  it("computes healthy-fixture values", () => {
    const results = computeMetrics(inputsFor());
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    // window covers payroll for buckets: income 6000×3 = 18000, spending 3000×3 = 9000
    expect(by.net_cash_flow_margin.value).toBeCloseTo(0.5, 1);
    expect(by.fixed_cost_ratio.value).toBeCloseTo(2500 * 3 / 18000, 1);
    expect(by.liquid_runway_months.availability).toBe("available");
    expect(by.debt_service_ratio.value).toBeCloseTo(1200 / 18000, 2);
    expect(by.revolving_utilization.value).toBeCloseTo(0.3, 1);
    expect(by.income_consistency.availability).toBe("available");
    expect(by.institution_concentration.availability).toBe("available");
  });

  it("guards zero income: income-denominated metrics unavailable, never Infinity", () => {
    const results = computeMetrics(inputsFor({ txns: [] }));
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    for (const id of ["net_cash_flow_margin", "fixed_cost_ratio", "debt_service_ratio", "contribution_rate", "income_source_concentration"]) {
      expect(by[id].availability, id).toBe("unavailable");
      expect(by[id].curveScore, id).toBeNull();
    }
  });

  it("marks debt metrics not_applicable for a debt-free household", () => {
    const noDebt = ACCOUNTS.filter((a) => a.type !== "credit_card");
    const fx = healthyFixture();
    const txns = fx.txns.filter((t) => t.accountId !== "card" && !t.transferPairId?.startsWith("dpi"));
    const results = computeMetrics(buildMetricInputs(fx.snapshots.map((s) => ({ ...s, revolvingBalances: 0 })), txns, noDebt, AS_OF));
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by.debt_service_ratio.availability).toBe("not_applicable");
    expect(by.revolving_utilization.availability).toBe("not_applicable");
    expect(by.weighted_interest_burden.availability).toBe("not_applicable");
  });

  it("marks utilization unavailable (not fabricated) when limits are missing", () => {
    const noLimit = ACCOUNTS.map((a) => a.type === "credit_card" ? { ...a, creditLimit: null } : a);
    const by = Object.fromEntries(computeMetrics(inputsFor({ accounts: noLimit })).map((r) => [r.id, r]));
    expect(by.revolving_utilization.availability).toBe("unavailable");
    expect(by.revolving_utilization.reason).toMatch(/limit/i);
  });

  it("requires full 90-day history for volatility/consistency metrics", () => {
    const fx = healthyFixture();
    const shortSnaps = fx.snapshots.slice(-40); // ~40 days of history
    const results = computeMetrics(buildMetricInputs(shortSnaps, fx.txns, ACCOUNTS, AS_OF));
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by.expense_volatility.availability).toBe("unavailable");
    expect(by.income_consistency.availability).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/metrics.test.ts`
Expected: FAIL — `Cannot find module './metrics'`.

- [ ] **Step 3: Implement `metrics.ts`**

```ts
/**
 * PFI score metric registry. Declarative: one entry per metric with the
 * consumer-facing name, formula, assumptions, and limitations. Scoring
 * curves live in scoring.ts. Normative: docs/FINANCIAL_HEALTH_SCORE.md.
 */
import { BUCKETS, WINDOW_DAYS, type MetricInputs } from "./metric-inputs";
import type { DimensionKey, MetricResult } from "./score-types";

export type MetricComputation =
  | { value: number }
  | { unavailable: string }
  | { notApplicable: string };

export interface MetricDef {
  id: string;
  name: string;
  dimension: DimensionKey;
  scored: boolean;
  definition: string;
  assumptions: string[];
  limitations: string[];
  format: (value: number) => string;
  compute: (inputs: MetricInputs) => MetricComputation;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const months = (v: number) => `${v.toFixed(1)} mo`;
const ratio = (v: number) => v.toFixed(2);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Coefficient of variation; null when mean is 0. */
function cv(values: number[]): number | null {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

const monthlyIncomeAvg = (i: MetricInputs) => i.totals.income / BUCKETS;
const monthlyEssentialAvg = (i: MetricInputs) => i.totals.essential / BUCKETS;
const NO_INCOME = "No income recorded in the last 90 days";
const fullHistory = (i: MetricInputs) => i.historyDays >= WINDOW_DAYS;

export const METRICS: MetricDef[] = [
  // ── Cash Flow Health ──────────────────────────────────────────────
  {
    id: "net_cash_flow_margin", name: "Monthly surplus margin", dimension: "cash_flow", scored: true,
    definition: "(income − spending) / income over the last 90 days. Spending excludes transfers and money you saved or invested.",
    assumptions: ["Refunds reduce spending", "Savings and investment contributions are not spending"],
    limitations: ["Business and shared-household expenses are treated as ordinary household spending"],
    format: pct,
    compute: (i) => i.totals.income <= 0
      ? { unavailable: NO_INCOME }
      : { value: clamp((i.totals.income - i.totals.spending) / i.totals.income, -1, 1) },
  },
  {
    id: "fixed_cost_ratio", name: "Essential-cost share", dimension: "cash_flow", scored: true,
    definition: "Essential (must-pay) spending as a share of income over the last 90 days.",
    assumptions: ["Uses the transaction 'essential' flag; unflagged spending counts as non-essential"],
    limitations: ["Depends on categorization quality"],
    format: pct,
    compute: (i) => i.totals.income <= 0
      ? { unavailable: NO_INCOME }
      : { value: clamp(i.totals.essential / i.totals.income, 0, 1) },
  },
  {
    id: "expense_volatility", name: "Spending steadiness", dimension: "cash_flow", scored: true,
    definition: "How much monthly spending swings (coefficient of variation across three 30-day periods). Lower is steadier.",
    assumptions: ["Three 30-day periods ending today"],
    limitations: ["Needs a full 90 days of history"],
    format: ratio,
    compute: (i) => {
      if (!fullHistory(i)) return { unavailable: "Needs 90 days of history" };
      const spread = cv(i.buckets.map((b) => Math.max(b.spending, 0)));
      return spread === null ? { unavailable: "No spending recorded" } : { value: clamp(spread, 0, 2) };
    },
  },
  {
    id: "recurring_surplus", name: "Typical monthly surplus", dimension: "cash_flow", scored: false,
    definition: "Median of (income − spending) across the three 30-day periods.",
    assumptions: [], limitations: ["Context only — never affects the score"],
    format: (v) => `$${Math.round(v).toLocaleString("en-US")}`,
    compute: (i) => {
      const nets = i.buckets.map((b) => b.income - b.spending).sort((a, b) => a - b);
      return { value: nets[Math.floor(nets.length / 2)] };
    },
  },
  // ── Liquidity & Resilience ────────────────────────────────────────
  {
    id: "liquid_runway_months", name: "Emergency runway", dimension: "liquidity", scored: true,
    definition: "How many months of essential expenses your liquid accounts (checking, savings, money market) could cover.",
    assumptions: ["Retirement, brokerage, and property never count as liquid"],
    limitations: ["Essential expenses come from flagged transactions in the last 90 days"],
    format: months,
    compute: (i) => {
      if (i.snapshot === null) return { unavailable: "No balance history yet" };
      const essential = monthlyEssentialAvg(i);
      if (essential <= 0) return { unavailable: "No essential expenses recorded in the last 90 days" };
      return { value: clamp(i.snapshot.liquidAssets / essential, 0, 60) };
    },
  },
  {
    id: "obligation_coverage", name: "Near-term bill coverage", dimension: "liquidity", scored: true,
    definition: "Liquid assets divided by obligations due before your next expected income.",
    assumptions: ["Obligations come from the daily snapshot engine"],
    limitations: [],
    format: ratio,
    compute: (i) => {
      if (i.snapshot === null) return { unavailable: "No balance history yet" };
      return { value: clamp(i.snapshot.liquidAssets / Math.max(i.snapshot.nearTermObligations, 1), 0, 10) };
    },
  },
  {
    id: "cash_drawdown", name: "Cash-balance stability", dimension: "liquidity", scored: true,
    definition: "The largest peak-to-trough drop in your liquid balances over the last 90 days, as a share of the peak.",
    assumptions: [], limitations: ["Needs at least two days of balance history"],
    format: pct,
    compute: (i) => {
      if (i.liquidSeries.length < 2) return { unavailable: "Not enough balance history" };
      let peak = i.liquidSeries[0];
      let worst = 0;
      for (const v of i.liquidSeries) {
        peak = Math.max(peak, v);
        if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
      }
      return { value: clamp(worst, 0, 1) };
    },
  },
  // ── Debt Health ───────────────────────────────────────────────────
  {
    id: "debt_service_ratio", name: "Debt burden", dimension: "debt", scored: true,
    definition: "Debt payments (loans and credit cards, excluding housing) as a share of income over the last 90 days.",
    assumptions: ["Housing costs are measured by essential-cost share, not here (counted once)"],
    limitations: ["Principal and interest are not separated"],
    format: pct,
    compute: (i) => {
      if (i.debtAccounts.length === 0 && i.totals.debtPayments === 0) return { notApplicable: "No debt — nothing to service" };
      if (i.totals.income <= 0) return { unavailable: NO_INCOME };
      return { value: clamp(i.totals.debtPayments / i.totals.income, 0, 1) };
    },
  },
  {
    id: "revolving_utilization", name: "Credit utilization", dimension: "debt", scored: true,
    definition: "Credit-card balances as a share of total credit limits.",
    assumptions: ["Uses current limits on file"],
    limitations: ["Unavailable until credit limits are recorded"],
    format: pct,
    compute: (i) => {
      if (!i.hasRevolvingAccounts) return { notApplicable: "No credit cards" };
      if (i.revolvingLimitTotal === null) return { unavailable: "No credit limits on file" };
      const balance = i.snapshot?.revolvingBalances ?? 0;
      return { value: clamp(balance / i.revolvingLimitTotal, 0, 1.5) };
    },
  },
  {
    id: "weighted_interest_burden", name: "Interest drag", dimension: "debt", scored: true,
    definition: "Estimated monthly interest across your debts as a share of monthly income. High-rate revolving debt weighs heaviest.",
    assumptions: ["Uses interest rates on file; estimated as balance × APR / 12"],
    limitations: ["Unavailable until interest rates are recorded"],
    format: pct,
    compute: (i) => {
      if (i.debtAccounts.length === 0) return { notApplicable: "No debt" };
      if (i.totals.income <= 0) return { unavailable: NO_INCOME };
      const rated = i.debtAccounts.filter((d) => d.rate !== null);
      if (rated.length === 0) return { unavailable: "No interest rates on file" };
      const monthlyInterest = rated.reduce((sum, d) => sum + d.balance * (d.rate ?? 0), 0) / 12;
      return { value: clamp(monthlyInterest / monthlyIncomeAvg(i), 0, 1) };
    },
  },
  {
    id: "revolving_trajectory", name: "Card-balance direction", dimension: "debt", scored: true,
    definition: "How your credit-card balances moved over the last 90 days, relative to monthly income. Falling balances score higher.",
    assumptions: [], limitations: [],
    format: pct,
    compute: (i) => {
      if (!i.hasRevolvingAccounts) return { notApplicable: "No credit cards" };
      if (i.revolvingStart === null || i.revolvingEnd === null) return { unavailable: "Not enough balance history" };
      if (i.totals.income <= 0) return { unavailable: NO_INCOME };
      return { value: clamp((i.revolvingEnd - i.revolvingStart) / monthlyIncomeAvg(i), -2, 2) };
    },
  },
  // ── Stability ─────────────────────────────────────────────────────
  {
    id: "income_consistency", name: "Income consistency", dimension: "stability", scored: true,
    definition: "How much monthly income swings (coefficient of variation across three 30-day periods). Lower is steadier.",
    assumptions: ["One-time income is included, never smoothed"],
    limitations: ["Needs a full 90 days of history", "Salaried vs self-employed patterns are not yet distinguished"],
    format: ratio,
    compute: (i) => {
      if (!fullHistory(i)) return { unavailable: "Needs 90 days of history" };
      const spread = cv(i.buckets.map((b) => b.income));
      return spread === null ? { unavailable: NO_INCOME } : { value: clamp(spread, 0, 2) };
    },
  },
  {
    id: "recurring_income_coverage", name: "Reliable-income coverage", dimension: "stability", scored: true,
    definition: "Average monthly income from repeating sources, divided by average monthly essential expenses.",
    assumptions: ["A source is 'repeating' when it appears in at least two of the three 30-day periods"],
    limitations: [],
    format: ratio,
    compute: (i) => {
      const essential = monthlyEssentialAvg(i);
      if (essential <= 0) return { unavailable: "No essential expenses recorded in the last 90 days" };
      return { value: clamp(i.recurringIncomeMonthlyAvg / essential, 0, 10) };
    },
  },
  {
    id: "irregular_income_reliance", name: "One-off income reliance", dimension: "stability", scored: true,
    definition: "The share of your income that came from non-repeating sources in the last 90 days.",
    assumptions: [], limitations: [],
    format: pct,
    compute: (i) => {
      if (i.totals.income <= 0) return { unavailable: NO_INCOME };
      const recurring = i.incomeSources.filter((s) => s.recurring).reduce((sum, s) => sum + s.total, 0);
      return { value: clamp(1 - recurring / i.totals.income, 0, 1) };
    },
  },
  // ── Growth ────────────────────────────────────────────────────────
  {
    id: "contribution_rate", name: "Contribution rate", dimension: "growth", scored: true,
    definition: "Money you moved into savings and investments as a share of income over the last 90 days. Only your own contributions count — market gains never move this.",
    assumptions: ["Transfers into brokerage/retirement accounts and 'savings'-categorized outflows count as contributions"],
    limitations: ["Debt principal reduction is not yet counted (no principal/interest split)"],
    format: pct,
    compute: (i) => i.totals.income <= 0
      ? { unavailable: NO_INCOME }
      : { value: clamp(i.totals.contributions / i.totals.income, 0, 1) },
  },
  {
    id: "contribution_consistency", name: "Contribution consistency", dimension: "growth", scored: true,
    definition: "In how many of the last three 30-day periods you made at least one contribution.",
    assumptions: [], limitations: [],
    format: (v) => `${Math.round(v * BUCKETS)} of ${BUCKETS} months`,
    compute: (i) => ({ value: i.buckets.filter((b) => b.contributions > 0).length / BUCKETS }),
  },
  // ── Concentration ─────────────────────────────────────────────────
  {
    id: "institution_concentration", name: "Institution concentration", dimension: "concentration", scored: true,
    definition: "The largest share of your asset balances held at a single institution.",
    assumptions: ["Positive asset balances only"],
    limitations: ["Investment holdings (single stocks, sectors) are not yet analyzed"],
    format: pct,
    compute: (i) => i.institutionShares.length === 0
      ? { unavailable: "Needs at least two accounts with balances" }
      : { value: i.institutionShares[0] },
  },
  {
    id: "income_source_concentration", name: "Income-source concentration", dimension: "concentration", scored: true,
    definition: "The share of your income coming from your largest source. One steady job is normal — irregularity is measured separately.",
    assumptions: [], limitations: [],
    format: pct,
    compute: (i) => {
      if (i.totals.income <= 0 || i.incomeSources.length === 0) return { unavailable: NO_INCOME };
      return { value: clamp(i.incomeSources[0].total / i.totals.income, 0, 1) };
    },
  },
];

export function computeMetrics(inputs: MetricInputs): MetricResult[] {
  return METRICS.map((def) => {
    const outcome = def.compute(inputs);
    const base = {
      id: def.id, name: def.name, dimension: def.dimension, scored: def.scored,
      definition: def.definition, assumptions: def.assumptions, limitations: def.limitations,
      curveScore: null, // filled in by scoring.ts for scored, available metrics
    };
    if ("value" in outcome) {
      return { ...base, availability: "available" as const, value: outcome.value, formatted: def.format(outcome.value), reason: null };
    }
    if ("unavailable" in outcome) {
      return { ...base, availability: "unavailable" as const, value: null, formatted: null, reason: outcome.unavailable };
    }
    return { ...base, availability: "not_applicable" as const, value: null, formatted: null, reason: outcome.notApplicable };
  });
}
```

Note: the registry has **17 scored metrics** across the six dimensions (the spec's per-dimension tables) plus explanation-only entries.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/metrics.test.ts`
Expected: PASS. If a fixture expectation is off by rounding, fix the *expectation math* only after re-deriving it by hand — never loosen an assertion to make it pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/metrics.ts src/lib/financial-engine/metrics.test.ts
git commit -m "feat(engine): PFI metric registry with 17 scored metrics and guards"
```

---

### Task 3: `scoring.ts` — curves, dimensions, computeScore

**Files:**
- Create: `src/lib/financial-engine/scoring.ts`
- Test: `src/lib/financial-engine/scoring.test.ts`

**Interfaces:**
- Consumes: `MetricResult`, `ScoreBreakdown`, `DimensionKey`, `ConfidenceLevel`, `PFI_SCORE_VERSION` from `./score-types`.
- Produces: `piecewiseLinear(points: Array<[number, number]>, x: number): number`, `CURVES: Record<string, Array<[number, number]>>`, `DIMENSIONS: Array<{ key: DimensionKey; label: string; weight: number; requiredMetric: string | null }>`, `SCORE_BANDS`, `bandFor(overall: number): string`, `computeScore(metricResults: MetricResult[], dimensionConfidence: Record<DimensionKey, { level: ConfidenceLevel; reasons: string[] }>, asOfDate: ISODate): ScoreBreakdown`.

Key rules (all from FINANCIAL_HEALTH_SCORE.md — treat as acceptance criteria):
- Weights: cash_flow .25, liquidity .20, debt .20, stability .15, growth .15, concentration .05.
- `requiredMetric` per dimension: cash_flow→`net_cash_flow_margin`, liquidity→`liquid_runway_months`, stability→`income_consistency`, growth→`contribution_rate`, concentration→**both** its metrics must be available, debt→special: eligible when any scored metric is available OR all are `not_applicable` (debt-free ⇒ score 100).
- Dimension score = round(mean of available scored metrics' curve scores); `not_applicable` metrics are excluded from the mean (except the all-NA debt-free case ⇒ 100).
- Overall: requires cash_flow AND liquidity eligible AND ≥4 eligible → `full` (6 eligible) or `provisional` (4–5, with a note naming missing dimensions); otherwise `suppressed` (overall null, notes say why and what would unlock it). `overall = round(Σ score × effectiveWeight × 9)`.
- Protection: always `{ status: "not_assessed", includedInScore: false }` in v1.
- Ineligible dimensions get `confidence: "insufficient_data"` regardless of the passed-in level.

- [ ] **Step 1: Write the failing tests**

`src/lib/financial-engine/scoring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ConfidenceLevel, DimensionKey, MetricResult } from "./score-types";
import { CURVES, DIMENSIONS, bandFor, computeScore, piecewiseLinear } from "./scoring";
import { METRICS } from "./metrics";

const HIGH: Record<DimensionKey, { level: ConfidenceLevel; reasons: string[] }> = {
  cash_flow: { level: "high", reasons: [] }, liquidity: { level: "high", reasons: [] },
  debt: { level: "high", reasons: [] }, stability: { level: "high", reasons: [] },
  growth: { level: "high", reasons: [] }, concentration: { level: "high", reasons: [] },
};

function metric(id: string, dimension: DimensionKey, value: number | null, availability: MetricResult["availability"] = value === null ? "unavailable" : "available"): MetricResult {
  return {
    id, name: id, dimension, scored: true, availability, value,
    formatted: value === null ? null : String(value), curveScore: null,
    definition: "test metric definition", assumptions: [], limitations: [],
    reason: availability === "available" ? null : "test reason",
  };
}

/** All 17 scored metrics available with mid-range healthy values. */
function fullResults(): MetricResult[] {
  const values: Record<string, number> = {
    net_cash_flow_margin: 0.2, fixed_cost_ratio: 0.4, expense_volatility: 0.2,
    liquid_runway_months: 6, obligation_coverage: 3, cash_drawdown: 0.1,
    debt_service_ratio: 0.1, revolving_utilization: 0.1, weighted_interest_burden: 0.01, revolving_trajectory: -0.25,
    income_consistency: 0.05, recurring_income_coverage: 2, irregular_income_reliance: 0.1,
    contribution_rate: 0.15, contribution_consistency: 1,
    institution_concentration: 0.35, income_source_concentration: 0.6,
  };
  return METRICS.filter((m) => m.scored).map((m) => metric(m.id, m.dimension, values[m.id]));
}

describe("piecewiseLinear", () => {
  it("interpolates, clamps at both ends, and handles descending curves", () => {
    const curve: Array<[number, number]> = [[0, 0], [1, 60], [3, 100]];
    expect(piecewiseLinear(curve, 0.5)).toBe(30);
    expect(piecewiseLinear(curve, -5)).toBe(0);
    expect(piecewiseLinear(curve, 99)).toBe(100);
    expect(piecewiseLinear([[0.3, 100], [0.9, 0]], 0.6)).toBe(50);
  });
});

describe("DIMENSIONS", () => {
  it("weights total exactly 1.0 across six dimensions; every scored metric has a curve", () => {
    expect(DIMENSIONS).toHaveLength(6);
    expect(DIMENSIONS.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(1.0, 10);
    for (const m of METRICS.filter((m) => m.scored)) expect(CURVES[m.id], m.id).toBeDefined();
  });
});

describe("computeScore", () => {
  it("produces a full 0–900 score with all dimensions eligible and version stamped", () => {
    const b = computeScore(fullResults(), HIGH, "2026-07-15");
    expect(b.state).toBe("full");
    expect(b.version).toBe("1.0");
    expect(b.overall).toBeGreaterThan(700); // healthy values → high score
    expect(b.overall).toBeLessThanOrEqual(900);
    expect(b.band).toBe(bandFor(b.overall!));
    expect(b.dimensions.every((d) => d.eligible && d.score !== null)).toBe(true);
    expect(Object.values(b.effectiveWeights).reduce((s, w) => s + (w ?? 0), 0)).toBeCloseTo(1.0, 10);
    expect(b.protection).toEqual({ status: "not_assessed", includedInScore: false });
  });

  it("scores a debt-free household 100 on Debt with all-not_applicable metrics", () => {
    const results = fullResults().map((r) => r.dimension === "debt" ? { ...r, availability: "not_applicable" as const, value: null } : r);
    const b = computeScore(results, HIGH, "2026-07-15");
    const debt = b.dimensions.find((d) => d.key === "debt")!;
    expect(debt.eligible).toBe(true);
    expect(debt.score).toBe(100);
  });

  it("renormalizes to a provisional score when Concentration is ineligible", () => {
    const results = fullResults().map((r) => r.dimension === "concentration" ? { ...r, availability: "unavailable" as const, value: null } : r);
    const b = computeScore(results, HIGH, "2026-07-15");
    expect(b.state).toBe("provisional");
    expect(b.overall).not.toBeNull();
    expect(b.effectiveWeights.concentration).toBeUndefined();
    // remaining weights renormalized over 0.95
    expect(b.effectiveWeights.cash_flow).toBeCloseTo(0.25 / 0.95, 5);
    expect(b.notes.join(" ")).toMatch(/provisional/i);
    const conc = b.dimensions.find((d) => d.key === "concentration")!;
    expect(conc.score).toBeNull();
    expect(conc.confidence).toBe("insufficient_data");
  });

  it("suppresses the overall score when Cash Flow is ineligible", () => {
    const results = fullResults().map((r) => r.dimension === "cash_flow" ? { ...r, availability: "unavailable" as const, value: null } : r);
    const b = computeScore(results, HIGH, "2026-07-15");
    expect(b.state).toBe("suppressed");
    expect(b.overall).toBeNull();
    expect(b.band).toBeNull();
    expect(b.notes.length).toBeGreaterThan(0);
  });

  it("suppresses when fewer than four dimensions are eligible", () => {
    const results = fullResults().map((r) =>
      ["debt", "stability", "growth"].includes(r.dimension) ? { ...r, availability: "unavailable" as const, value: null } : r,
    );
    const b = computeScore(results, HIGH, "2026-07-15");
    expect(b.state).toBe("suppressed");
  });

  it("never lets explanation-only metrics affect a dimension score", () => {
    const withExplainOnly = [
      ...fullResults(),
      { ...metric("recurring_surplus", "cash_flow", -99999), scored: false },
    ];
    const a = computeScore(fullResults(), HIGH, "2026-07-15");
    const b = computeScore(withExplainOnly, HIGH, "2026-07-15");
    expect(b.dimensions.find((d) => d.key === "cash_flow")!.score)
      .toBe(a.dimensions.find((d) => d.key === "cash_flow")!.score);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/scoring.test.ts`
Expected: FAIL — `Cannot find module './scoring'`.

- [ ] **Step 3: Implement `scoring.ts`**

```ts
/**
 * PFI score curves, dimensions, and aggregation.
 * All anchor values are normative from docs/FINANCIAL_HEALTH_SCORE.md —
 * change them there first, then here, and bump PFI_SCORE_VERSION.
 */
import type { ISODate } from "./types";
import {
  PFI_SCORE_VERSION,
  type ConfidenceLevel, type DimensionKey, type DimensionResult,
  type MetricResult, type ScoreBreakdown,
} from "./score-types";

export function piecewiseLinear(points: Array<[number, number]>, x: number): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  if (x <= sorted[0][0]) return sorted[0][1];
  const last = sorted[sorted.length - 1];
  if (x >= last[0]) return last[1];
  for (let k = 1; k < sorted.length; k++) {
    const [x0, y0] = sorted[k - 1];
    const [x1, y1] = sorted[k];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

export const CURVES: Record<string, Array<[number, number]>> = {
  net_cash_flow_margin: [[-0.10, 0], [0, 35], [0.05, 55], [0.10, 70], [0.20, 90], [0.30, 100]],
  fixed_cost_ratio: [[0.30, 100], [0.40, 85], [0.50, 65], [0.60, 45], [0.75, 20], [0.90, 0]],
  expense_volatility: [[0.10, 100], [0.20, 80], [0.35, 55], [0.50, 30], [0.75, 0]],
  liquid_runway_months: [[0, 0], [1, 35], [3, 65], [6, 85], [12, 100]],
  obligation_coverage: [[0, 0], [1, 60], [2, 85], [3, 100]],
  cash_drawdown: [[0.10, 100], [0.25, 70], [0.50, 35], [0.75, 0]],
  debt_service_ratio: [[0.10, 100], [0.20, 80], [0.36, 50], [0.45, 25], [0.60, 0]],
  revolving_utilization: [[0, 100], [0.10, 90], [0.30, 65], [0.50, 40], [0.75, 15], [1, 0]],
  weighted_interest_burden: [[0.01, 100], [0.03, 75], [0.06, 45], [0.10, 20], [0.15, 0]],
  revolving_trajectory: [[-0.25, 100], [0, 65], [0.25, 35], [0.75, 0]],
  income_consistency: [[0.05, 100], [0.15, 80], [0.30, 55], [0.50, 30], [0.75, 0]],
  recurring_income_coverage: [[0, 0], [0.5, 25], [1, 60], [1.5, 85], [2, 100]],
  irregular_income_reliance: [[0.10, 100], [0.25, 75], [0.50, 45], [0.75, 20], [0.90, 0]],
  contribution_rate: [[0, 10], [0.05, 55], [0.10, 75], [0.15, 90], [0.20, 100]],
  contribution_consistency: [[0, 0], [1 / 3, 35], [2 / 3, 70], [1, 100]],
  institution_concentration: [[0.35, 100], [0.50, 80], [0.75, 45], [1, 20]],
  income_source_concentration: [[0.60, 100], [0.80, 75], [1, 55]],
};

export const DIMENSIONS: Array<{
  key: DimensionKey; label: string; weight: number; requiredMetric: string | null;
}> = [
  { key: "cash_flow", label: "Cash Flow Health", weight: 0.25, requiredMetric: "net_cash_flow_margin" },
  { key: "liquidity", label: "Liquidity & Resilience", weight: 0.20, requiredMetric: "liquid_runway_months" },
  { key: "debt", label: "Debt Health", weight: 0.20, requiredMetric: null }, // special: debt-free rule
  { key: "stability", label: "Stability", weight: 0.15, requiredMetric: "income_consistency" },
  { key: "growth", label: "Growth", weight: 0.15, requiredMetric: "contribution_rate" },
  { key: "concentration", label: "Concentration", weight: 0.05, requiredMetric: null }, // special: all metrics required
];

export const SCORE_BANDS: Array<{ min: number; label: string }> = [
  { min: 750, label: "Excellent" }, { min: 640, label: "Strong" },
  { min: 500, label: "Fair" }, { min: 350, label: "Building" },
  { min: 0, label: "Needs attention" },
];

export function bandFor(overall: number): string {
  return SCORE_BANDS.find((b) => overall >= b.min)!.label;
}

export function computeScore(
  metricResults: MetricResult[],
  dimensionConfidence: Record<DimensionKey, { level: ConfidenceLevel; reasons: string[] }>,
  asOfDate: ISODate,
): ScoreBreakdown {
  const dimensions: DimensionResult[] = DIMENSIONS.map((dim) => {
    const mine = metricResults
      .filter((m) => m.dimension === dim.key)
      .map((m) =>
        m.scored && m.availability === "available" && m.value !== null
          ? { ...m, curveScore: Math.round(piecewiseLinear(CURVES[m.id], m.value)) }
          : m,
      );
    const scoredMine = mine.filter((m) => m.scored);
    const available = scoredMine.filter((m) => m.availability === "available");
    const allNotApplicable = scoredMine.length > 0 && scoredMine.every((m) => m.availability === "not_applicable");

    let eligible: boolean;
    let exclusionReason: string | null = null;
    if (dim.key === "debt") {
      eligible = available.length > 0 || allNotApplicable;
      if (!eligible) exclusionReason = firstReason(scoredMine) ?? "No debt data available";
    } else if (dim.key === "concentration") {
      eligible = available.length === scoredMine.length && scoredMine.length > 0;
      if (!eligible) exclusionReason = firstReason(scoredMine) ?? "Not enough account and income data";
    } else {
      const required = scoredMine.find((m) => m.id === dim.requiredMetric);
      eligible = required?.availability === "available";
      if (!eligible) exclusionReason = required?.reason ?? "Required data unavailable";
    }

    const score = !eligible
      ? null
      : allNotApplicable
        ? 100 // debt-free rule: known good data, not missing data
        : Math.round(available.reduce((s, m) => s + (m.curveScore ?? 0), 0) / available.length);

    const conf = dimensionConfidence[dim.key];
    return {
      key: dim.key, label: dim.label, configuredWeight: dim.weight,
      eligible, exclusionReason, score,
      confidence: eligible ? conf.level : "insufficient_data",
      confidenceReasons: eligible ? conf.reasons : [exclusionReason ?? ""].filter(Boolean),
      metrics: mine,
    };
  });

  const eligibleDims = dimensions.filter((d) => d.eligible);
  const requiredOk =
    dimensions.find((d) => d.key === "cash_flow")!.eligible &&
    dimensions.find((d) => d.key === "liquidity")!.eligible;
  const notes: string[] = [];
  let state: ScoreBreakdown["state"];
  let overall: number | null = null;
  const effectiveWeights: Partial<Record<DimensionKey, number>> = {};

  if (!requiredOk || eligibleDims.length < 4) {
    state = "suppressed";
    const missing = dimensions.filter((d) => !d.eligible);
    notes.push(
      `Your PFI score is not available yet: ${missing.map((d) => `${d.label} — ${d.exclusionReason}`).join("; ")}.`,
      "Adding the missing data above will unlock your score.",
    );
  } else {
    const weightSum = eligibleDims.reduce((s, d) => s + d.configuredWeight, 0);
    for (const d of eligibleDims) effectiveWeights[d.key] = d.configuredWeight / weightSum;
    overall = Math.round(eligibleDims.reduce((s, d) => s + (d.score ?? 0) * (effectiveWeights[d.key] ?? 0) * 9, 0));
    state = eligibleDims.length === 6 ? "full" : "provisional";
    if (state === "provisional") {
      const missing = dimensions.filter((d) => !d.eligible);
      notes.push(
        `Your current PFI is provisional because ${missing.map((d) => `${d.label.toLowerCase()} data is unavailable (${lc(d.exclusionReason)})`).join(" and ")}. Weights were redistributed across the ${eligibleDims.length} measurable dimensions.`,
      );
    }
  }

  const cf = dimensions.find((d) => d.key === "cash_flow")!;
  const liq = dimensions.find((d) => d.key === "liquidity")!;
  const overallConfidence =
    state === "suppressed" ? "insufficient_data"
      : degrade(minLevel(levelOf(cf.confidence), levelOf(liq.confidence)), eligibleDims.length < 6 ? 1 : 0);

  return {
    version: PFI_SCORE_VERSION, asOfDate, state, overall,
    band: overall === null ? null : bandFor(overall),
    overallConfidence,
    configuredWeights: Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.weight])) as Record<DimensionKey, number>,
    effectiveWeights, dimensions,
    protection: { status: "not_assessed", includedInScore: false },
    notes,
  };
}

function firstReason(metrics: MetricResult[]): string | null {
  return metrics.find((m) => m.reason !== null)?.reason ?? null;
}
function lc(s: string | null): string {
  return (s ?? "data missing").replace(/^./, (c) => c.toLowerCase());
}
const ORDER: ConfidenceLevel[] = ["high", "moderate", "limited"];
function levelOf(c: ConfidenceLevel | "insufficient_data"): ConfidenceLevel {
  return c === "insufficient_data" ? "limited" : c;
}
function minLevel(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return ORDER[Math.max(ORDER.indexOf(a), ORDER.indexOf(b))];
}
function degrade(level: ConfidenceLevel, steps: number): ConfidenceLevel {
  return ORDER[Math.min(ORDER.indexOf(level) + steps, ORDER.length - 1)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/scoring.test.ts src/lib/financial-engine/metrics.test.ts`
Expected: PASS (both files — metrics tests must still be green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/scoring.ts src/lib/financial-engine/scoring.test.ts
git commit -m "feat(engine): PFI scoring — curves, six dimensions, eligibility and renormalization"
```

---

### Task 4: `confidence.ts`

**Files:**
- Create: `src/lib/financial-engine/confidence.ts`
- Test: `src/lib/financial-engine/confidence.test.ts`

**Interfaces:**
- Consumes: `MetricInputs`, `WINDOW_DAYS` from `./metric-inputs`; `MetricResult`, `DimensionKey`, `ConfidenceLevel` from `./score-types`.
- Produces: `computeConfidence(inputs: MetricInputs, metricResults: MetricResult[]): ConfidenceReport` where `ConfidenceReport = { byDimension: Record<DimensionKey, { level: ConfidenceLevel; reasons: string[] }>; improvements: string[] }`.

Deterministic rules (spec "Confidence / data coverage"):
1. Start `high` per dimension.
2. `historyDays < 90` → cap at `moderate`, reason "Less than 90 days of history". `historyDays < 60` → cap at `limited`, reason "Less than 60 days of history".
3. Any of the dimension's **scored** metrics `unavailable` → drop one level, reason = that metric's reason. (`not_applicable` never penalizes.)
4. `dataQuality.uncategorizedShare > 0.10` → drop one level for `cash_flow`, `stability`, `growth`, reason "Over 10% of transactions are uncategorized".
5. `dataQuality.demo` → cap at `moderate`, reason "Demo dataset".
6. `improvements` = deduplicated, actionable list derived from every reason recorded (e.g. "Add credit limits to your credit-card accounts", "Categorize more transactions").

- [ ] **Step 1: Write the failing tests**

`src/lib/financial-engine/confidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeConfidence } from "./confidence";
import type { MetricInputs } from "./metric-inputs";
import type { MetricResult } from "./score-types";

function inputs(partial: Partial<MetricInputs> = {}): MetricInputs {
  return {
    asOfDate: "2026-07-15", windowStart: "2026-04-17", historyDays: 120,
    buckets: [], totals: { income: 1, spending: 0, essential: 0, contributions: 0, debtPayments: 0 },
    incomeSources: [], recurringIncomeMonthlyAvg: 0, snapshot: null, liquidSeries: [],
    revolvingStart: null, revolvingEnd: null, debtAccounts: [], hasRevolvingAccounts: false,
    revolvingLimitTotal: null, institutionShares: [], accountCount: 2,
    dataQuality: { uncategorizedShare: 0, demo: false },
    ...partial,
  };
}

function available(id: string, dimension: MetricResult["dimension"]): MetricResult {
  return { id, name: id, dimension, scored: true, availability: "available", value: 1, formatted: "1", curveScore: null, definition: "d", assumptions: [], limitations: [], reason: null };
}

describe("computeConfidence", () => {
  it("is high everywhere with full history and no gaps", () => {
    const report = computeConfidence(inputs(), [available("m1", "cash_flow")]);
    expect(report.byDimension.cash_flow.level).toBe("high");
    expect(report.improvements).toEqual([]);
  });

  it("caps at moderate under 90 days and limited under 60 days of history", () => {
    expect(computeConfidence(inputs({ historyDays: 80 }), []).byDimension.debt.level).toBe("moderate");
    expect(computeConfidence(inputs({ historyDays: 45 }), []).byDimension.debt.level).toBe("limited");
  });

  it("drops a level when a scored metric is unavailable, with the metric's reason", () => {
    const missing: MetricResult = { ...available("revolving_utilization", "debt"), availability: "unavailable", value: null, reason: "No credit limits on file" };
    const report = computeConfidence(inputs(), [missing]);
    expect(report.byDimension.debt.level).toBe("moderate");
    expect(report.byDimension.debt.reasons).toContain("No credit limits on file");
    expect(report.improvements.length).toBeGreaterThan(0);
  });

  it("does not penalize not_applicable metrics", () => {
    const na: MetricResult = { ...available("debt_service_ratio", "debt"), availability: "not_applicable", value: null, reason: "No debt" };
    expect(computeConfidence(inputs(), [na]).byDimension.debt.level).toBe("high");
  });

  it("penalizes uncategorized transactions only for category-driven dimensions", () => {
    const report = computeConfidence(inputs({ dataQuality: { uncategorizedShare: 0.2, demo: false } }), []);
    expect(report.byDimension.cash_flow.level).toBe("moderate");
    expect(report.byDimension.liquidity.level).toBe("high");
  });

  it("caps everything at moderate for demo data", () => {
    const report = computeConfidence(inputs({ dataQuality: { uncategorizedShare: 0, demo: true } }), []);
    for (const dim of Object.values(report.byDimension)) {
      expect(["moderate", "limited"]).toContain(dim.level);
    }
    expect(report.byDimension.cash_flow.reasons).toContain("Demo dataset");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/confidence.test.ts`
Expected: FAIL — `Cannot find module './confidence'`.

- [ ] **Step 3: Implement `confidence.ts`**

```ts
/**
 * Per-dimension confidence derivation. Deterministic; rules are normative
 * in docs/FINANCIAL_HEALTH_SCORE.md ("Confidence / data coverage").
 */
import { WINDOW_DAYS, type MetricInputs } from "./metric-inputs";
import type { ConfidenceLevel, DimensionKey, MetricResult } from "./score-types";

export interface ConfidenceReport {
  byDimension: Record<DimensionKey, { level: ConfidenceLevel; reasons: string[] }>;
  improvements: string[];
}

const ALL_DIMENSIONS: DimensionKey[] = ["cash_flow", "liquidity", "debt", "stability", "growth", "concentration"];
const CATEGORY_DRIVEN: ReadonlySet<DimensionKey> = new Set(["cash_flow", "stability", "growth"]);
const ORDER: ConfidenceLevel[] = ["high", "moderate", "limited"];

const IMPROVEMENTS: Array<{ match: RegExp; advice: string }> = [
  { match: /credit limit/i, advice: "Add credit limits to your credit-card accounts" },
  { match: /interest rate/i, advice: "Add interest rates to your loan and card accounts" },
  { match: /uncategorized/i, advice: "Categorize more of your transactions" },
  { match: /days of history/i, advice: "Keep your data connected — accuracy improves with history" },
  { match: /demo dataset/i, advice: "Replace demo data with your own accounts" },
  { match: /income/i, advice: "Record your income transactions" },
];

function cap(level: ConfidenceLevel, atMost: ConfidenceLevel): ConfidenceLevel {
  return ORDER[Math.max(ORDER.indexOf(level), ORDER.indexOf(atMost))];
}
function drop(level: ConfidenceLevel): ConfidenceLevel {
  return ORDER[Math.min(ORDER.indexOf(level) + 1, ORDER.length - 1)];
}

export function computeConfidence(inputs: MetricInputs, metricResults: MetricResult[]): ConfidenceReport {
  const byDimension = {} as ConfidenceReport["byDimension"];
  const allReasons: string[] = [];

  for (const key of ALL_DIMENSIONS) {
    let level: ConfidenceLevel = "high";
    const reasons: string[] = [];

    if (inputs.historyDays < 60) {
      level = cap(level, "limited");
      reasons.push("Less than 60 days of history");
    } else if (inputs.historyDays < WINDOW_DAYS) {
      level = cap(level, "moderate");
      reasons.push("Less than 90 days of history");
    }

    for (const m of metricResults) {
      if (m.dimension === key && m.scored && m.availability === "unavailable" && m.reason) {
        level = drop(level);
        reasons.push(m.reason);
      }
    }

    if (CATEGORY_DRIVEN.has(key) && inputs.dataQuality.uncategorizedShare > 0.10) {
      level = drop(level);
      reasons.push("Over 10% of transactions are uncategorized");
    }

    if (inputs.dataQuality.demo) {
      level = cap(level, "moderate");
      reasons.push("Demo dataset");
    }

    byDimension[key] = { level, reasons };
    allReasons.push(...reasons);
  }

  const improvements = [...new Set(
    allReasons.flatMap((r) => IMPROVEMENTS.filter((i) => i.match.test(r)).map((i) => i.advice)),
  )];
  return { byDimension, improvements };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/confidence.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/confidence.ts src/lib/financial-engine/confidence.test.ts
git commit -m "feat(engine): deterministic per-dimension score confidence"
```

---

### Task 5: `momentum-overlay.ts`

**Files:**
- Create: `src/lib/financial-engine/momentum-overlay.ts`
- Test: `src/lib/financial-engine/momentum-overlay.test.ts`

**Interfaces:**
- Consumes: `MomentumState` from `./score-types`.
- Produces: `MOMENTUM_THRESHOLD = 9`, `computeMomentum(points: { current: number | null; prior30: number | null; prior60: number | null }): MomentumState`, `momentumLabel(state: MomentumState): string` (consumer copy: "Strongly improving", "Improving", "Stable", "Weakening", "Deteriorating", "Recovering", "Not enough history yet").

- [ ] **Step 1: Write the failing tests**

`src/lib/financial-engine/momentum-overlay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MOMENTUM_THRESHOLD, computeMomentum, momentumLabel } from "./momentum-overlay";

describe("computeMomentum", () => {
  it.each([
    // [current, prior30, prior60, expected]
    [700, 680, 660, "strongly_improving"], // both segments +20 > 9
    [700, 685, 683, "improving"],          // recent +15, earlier +2 within threshold
    [700, 685, 700, "recovering"],         // recent +15 after a −15 decline
    [660, 680, 700, "deteriorating"],      // both segments −20
    [685, 700, 702, "weakening"],          // recent −15, earlier flat
    [700, 702, 699, "stable"],             // both inside ±9
  ])("(%s, %s, %s) → %s", (current, prior30, prior60, expected) => {
    expect(computeMomentum({ current, prior30, prior60 })).toBe(expected);
  });

  it("returns insufficient_history when any point is missing", () => {
    expect(computeMomentum({ current: 700, prior30: 690, prior60: null })).toBe("insufficient_history");
    expect(computeMomentum({ current: null, prior30: 690, prior60: 680 })).toBe("insufficient_history");
  });

  it("uses the documented threshold", () => {
    expect(MOMENTUM_THRESHOLD).toBe(9); // 1% of the 900 scale — spec value
  });

  it("labels every state with consumer copy", () => {
    expect(momentumLabel("insufficient_history")).toBe("Not enough history yet");
    expect(momentumLabel("strongly_improving")).toBe("Strongly improving");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/momentum-overlay.test.ts`
Expected: FAIL — `Cannot find module './momentum-overlay'`.

- [ ] **Step 3: Implement `momentum-overlay.ts`**

```ts
/**
 * Momentum is a directional overlay derived from score history.
 * It never feeds back into the weighted score (no double counting).
 * State machine is normative in docs/FINANCIAL_HEALTH_SCORE.md ("Momentum").
 */
import type { MomentumState } from "./score-types";

/** 1% of the 900-point scale. */
export const MOMENTUM_THRESHOLD = 9;

export function computeMomentum(points: {
  current: number | null; prior30: number | null; prior60: number | null;
}): MomentumState {
  const { current, prior30, prior60 } = points;
  if (current === null || prior30 === null || prior60 === null) return "insufficient_history";
  const d1 = current - prior30; // recent segment
  const d2 = prior30 - prior60; // earlier segment
  const t = MOMENTUM_THRESHOLD;
  if (d1 > t && d2 > t) return "strongly_improving";
  if (d1 > t && d2 < -t) return "recovering";
  if (d1 > t) return "improving";
  if (d1 < -t && d2 < -t) return "deteriorating";
  if (d1 < -t) return "weakening";
  return "stable";
}

const LABELS: Record<MomentumState, string> = {
  strongly_improving: "Strongly improving",
  improving: "Improving",
  stable: "Stable",
  weakening: "Weakening",
  deteriorating: "Deteriorating",
  recovering: "Recovering",
  insufficient_history: "Not enough history yet",
};

export function momentumLabel(state: MomentumState): string {
  return LABELS[state];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/momentum-overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/momentum-overlay.ts src/lib/financial-engine/momentum-overlay.test.ts
git commit -m "feat(engine): momentum directional overlay state machine"
```

---

### Task 6: `score-delta.ts`, engine exports, and the full-pipeline test

**Files:**
- Create: `src/lib/financial-engine/score-delta.ts`
- Test: `src/lib/financial-engine/score-delta.test.ts`
- Create: `src/lib/financial-engine/score-pipeline.test.ts`
- Modify: `src/lib/financial-engine/index.ts`

**Interfaces:**
- Consumes: `ScoreBreakdown`, `ScoreDelta`, `DimensionDelta`, `MetricMover` from `./score-types`.
- Produces: `computeScoreDelta(current: ScoreBreakdown, previous: ScoreBreakdown | null): ScoreDelta`. Rules: `previous === null` or `previous.state === "suppressed"` → `state: "insufficient_history"` (from/change null, note explains). Otherwise per-dimension deltas for all six; top movers = scored metrics available on both sides, impact = `(curveScore_now − curveScore_prev) / nAvailableNow × effectiveWeight_now × 9`, top 3 by absolute impact with |impact| ≥ 1 point; notes flag dimensions whose eligibility changed between the two dates.

- [ ] **Step 1: Write the failing tests**

`src/lib/financial-engine/score-delta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ConfidenceLevel, DimensionKey, MetricResult } from "./score-types";
import { METRICS } from "./metrics";
import { computeScore } from "./scoring";
import { computeScoreDelta } from "./score-delta";

const HIGH: Record<DimensionKey, { level: ConfidenceLevel; reasons: string[] }> = {
  cash_flow: { level: "high", reasons: [] }, liquidity: { level: "high", reasons: [] },
  debt: { level: "high", reasons: [] }, stability: { level: "high", reasons: [] },
  growth: { level: "high", reasons: [] }, concentration: { level: "high", reasons: [] },
};

function resultsWith(overrides: Record<string, number>): MetricResult[] {
  const base: Record<string, number> = {
    net_cash_flow_margin: 0.1, fixed_cost_ratio: 0.4, expense_volatility: 0.2,
    liquid_runway_months: 3, obligation_coverage: 2, cash_drawdown: 0.2,
    debt_service_ratio: 0.2, revolving_utilization: 0.3, weighted_interest_burden: 0.03, revolving_trajectory: 0,
    income_consistency: 0.15, recurring_income_coverage: 1.5, irregular_income_reliance: 0.25,
    contribution_rate: 0.1, contribution_consistency: 2 / 3,
    institution_concentration: 0.5, income_source_concentration: 0.8,
  };
  const values = { ...base, ...overrides };
  return METRICS.filter((m) => m.scored).map((m) => ({
    id: m.id, name: m.name, dimension: m.dimension, scored: true,
    availability: "available" as const, value: values[m.id], formatted: String(values[m.id]),
    curveScore: null, definition: m.definition, assumptions: [], limitations: [], reason: null,
  }));
}

describe("computeScoreDelta", () => {
  it("reports overall and per-dimension changes with top movers", () => {
    const previous = computeScore(resultsWith({}), HIGH, "2026-06-15");
    const current = computeScore(resultsWith({ net_cash_flow_margin: 0.25, revolving_utilization: 0.1 }), HIGH, "2026-07-15");
    const delta = computeScoreDelta(current, previous);
    expect(delta.state).toBe("ok");
    expect(delta.change).toBe(current.overall! - previous.overall!);
    expect(delta.dimensions).toHaveLength(6);
    const moverIds = delta.topMovers.map((m) => m.id);
    expect(moverIds).toContain("net_cash_flow_margin");
    expect(moverIds).toContain("revolving_utilization");
    expect(delta.topMovers.length).toBeLessThanOrEqual(3);
    const cashMover = delta.topMovers.find((m) => m.id === "net_cash_flow_margin")!;
    expect(cashMover.overallPointsImpact).toBeGreaterThan(0);
  });

  it("returns insufficient_history when there is no previous breakdown", () => {
    const current = computeScore(resultsWith({}), HIGH, "2026-07-15");
    const delta = computeScoreDelta(current, null);
    expect(delta.state).toBe("insufficient_history");
    expect(delta.change).toBeNull();
    expect(delta.notes.join(" ")).toMatch(/not enough history/i);
  });

  it("notes dimensions whose eligibility changed", () => {
    const prevResults = resultsWith({}).map((r) =>
      r.dimension === "concentration" ? { ...r, availability: "unavailable" as const, value: null, reason: "Needs at least two accounts with balances" } : r,
    );
    const previous = computeScore(prevResults, HIGH, "2026-06-15");
    const current = computeScore(resultsWith({}), HIGH, "2026-07-15");
    const delta = computeScoreDelta(current, previous);
    expect(delta.notes.join(" ")).toMatch(/concentration/i);
  });
});
```

`src/lib/financial-engine/score-pipeline.test.ts` — end-to-end engine test:

```ts
import { describe, expect, it } from "vitest";
import type { DailySnapshot } from "./types";
import { buildMetricInputs, type ScoreAccountInput, type ScoreTransactionInput } from "./metric-inputs";
import { computeMetrics } from "./metrics";
import { computeConfidence } from "./confidence";
import { computeScore } from "./scoring";
import { computeScoreDelta } from "./score-delta";
import { computeMomentum } from "./momentum-overlay";
import { addDays } from "./snapshot-builder";

const AS_OF = "2026-07-15";

const ACCOUNTS: ScoreAccountInput[] = [
  { id: "chk", type: "checking", institution: "First Bank", currentBalance: 9000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "sav", type: "savings", institution: "Ally", currentBalance: 15000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "card", type: "credit_card", institution: "First Bank", currentBalance: 1500, creditLimit: 10000, interestRate: 0.22, includeInCalculations: true, provider: "manual" },
  { id: "brk", type: "brokerage", institution: "Vanguard", currentBalance: 25000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
];

/** 180 days: payroll every 30d, rent/groceries, monthly 600 contribution + 500 card payment. */
function fixture(): { snapshots: DailySnapshot[]; txns: ScoreTransactionInput[] } {
  const txns: ScoreTransactionInput[] = [];
  const snapshots: DailySnapshot[] = [];
  const base = { accountId: "chk", category: null as string | null, essential: null as boolean | null, isTransfer: false, transferPairId: null, description: "" };
  for (let d = 179; d >= 0; d--) {
    const date = addDays(AS_OF, -d);
    snapshots.push({ date, liquidAssets: 20000 + (179 - d) * 25, revolvingBalances: 1500, nearTermObligations: 2600, essentialObligations: 2000, safetyBuffer: 1000, netWorth: 45000 });
    if (d % 30 === 0) {
      txns.push({ ...base, id: `pay${d}`, postedDate: date, amount: 5500, direction: "inflow", category: "income", description: "Employer payroll" });
      txns.push({ ...base, id: `rent${d}`, postedDate: date, amount: 1700, direction: "outflow", category: "housing", essential: true });
      txns.push({ ...base, id: `gro${d}`, postedDate: date, amount: 600, direction: "outflow", category: "groceries", essential: true });
      txns.push({ ...base, id: `co${d}`, postedDate: date, amount: 600, direction: "outflow", isTransfer: true, transferPairId: `ci${d}` });
      txns.push({ ...base, id: `ci${d}`, postedDate: date, amount: 600, direction: "inflow", accountId: "brk", isTransfer: true, transferPairId: `co${d}` });
      txns.push({ ...base, id: `do${d}`, postedDate: date, amount: 500, direction: "outflow", isTransfer: true, transferPairId: `di${d}` });
      txns.push({ ...base, id: `di${d}`, postedDate: date, amount: 500, direction: "inflow", accountId: "card", isTransfer: true, transferPairId: `do${d}` });
    }
  }
  return { snapshots, txns };
}

function breakdownAt(asOf: string) {
  const { snapshots, txns } = fixture();
  const inputs = buildMetricInputs(snapshots, txns, ACCOUNTS, asOf);
  const results = computeMetrics(inputs);
  const confidence = computeConfidence(inputs, results);
  return computeScore(results, confidence.byDimension, asOf);
}

describe("full score pipeline", () => {
  it("produces a full, versioned, explainable breakdown on healthy manual data", () => {
    const b = breakdownAt(AS_OF);
    expect(b.state).toBe("full");
    expect(b.version).toBe("1.0");
    expect(b.overall).toBeGreaterThanOrEqual(0);
    expect(b.overall).toBeLessThanOrEqual(900);
    expect(b.dimensions).toHaveLength(6);
    for (const d of b.dimensions) {
      expect(d.eligible, d.key).toBe(true);
      expect(d.score, d.key).not.toBeNull();
      // every scored+available metric is fully explainable
      for (const m of d.metrics.filter((m) => m.scored && m.availability === "available")) {
        expect(m.curveScore, m.id).not.toBeNull();
        expect(m.formatted, m.id).not.toBeNull();
      }
    }
    expect(b.protection.includedInScore).toBe(false);
  });

  it("is deterministic and stable across dates (steady fixture ⇒ stable momentum)", () => {
    const s0 = breakdownAt(AS_OF).overall!;
    const s30 = breakdownAt(addDays(AS_OF, -30)).overall!;
    const s60 = breakdownAt(addDays(AS_OF, -60)).overall!;
    expect(breakdownAt(AS_OF).overall).toBe(s0); // same inputs ⇒ same output
    expect(computeMomentum({ current: s0, prior30: s30, prior60: s60 })).toBe("stable");
    const delta = computeScoreDelta(breakdownAt(AS_OF), breakdownAt(addDays(AS_OF, -30)));
    expect(delta.state).toBe("ok");
    expect(Math.abs(delta.change ?? 99)).toBeLessThan(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/score-delta.test.ts src/lib/financial-engine/score-pipeline.test.ts`
Expected: FAIL — `Cannot find module './score-delta'`.

- [ ] **Step 3: Implement `score-delta.ts`**

```ts
/**
 * Deterministic score-delta explanation: a structural diff of two
 * ScoreBreakdowns. Produced BEFORE any AI narration (binding rule).
 */
import type { DimensionDelta, MetricMover, ScoreBreakdown, ScoreDelta } from "./score-types";

export function computeScoreDelta(current: ScoreBreakdown, previous: ScoreBreakdown | null): ScoreDelta {
  if (previous === null || previous.state === "suppressed") {
    return {
      state: "insufficient_history",
      from: null, to: current.overall, change: null,
      dimensions: [], topMovers: [],
      notes: ["Not enough history for this range to compare scores."],
    };
  }

  const notes: string[] = [];
  const dimensions: DimensionDelta[] = current.dimensions.map((d) => {
    const prev = previous.dimensions.find((p) => p.key === d.key);
    if (prev && prev.eligible !== d.eligible) {
      notes.push(
        d.eligible
          ? `${d.label} became measurable during this period.`
          : `${d.label} stopped being measurable during this period (${d.exclusionReason ?? "data unavailable"}).`,
      );
    }
    return {
      key: d.key, label: d.label,
      from: prev?.score ?? null, to: d.score,
      change: prev?.score != null && d.score != null ? d.score - prev.score : null,
    };
  });

  const movers: MetricMover[] = [];
  for (const dim of current.dimensions) {
    if (!dim.eligible) continue;
    const prevDim = previous.dimensions.find((p) => p.key === dim.key);
    if (!prevDim?.eligible) continue;
    const availableNow = dim.metrics.filter((m) => m.scored && m.availability === "available");
    const weight = current.effectiveWeights[dim.key] ?? 0;
    for (const m of availableNow) {
      const prevMetric = prevDim.metrics.find((p) => p.id === m.id);
      if (prevMetric?.availability !== "available" || m.curveScore === null || prevMetric.curveScore === null) continue;
      const impact = ((m.curveScore - prevMetric.curveScore) / availableNow.length) * weight * 9;
      if (Math.abs(impact) >= 1) {
        movers.push({ id: m.id, name: m.name, dimension: dim.key, overallPointsImpact: Math.round(impact) });
      }
    }
  }
  movers.sort((a, b) => Math.abs(b.overallPointsImpact) - Math.abs(a.overallPointsImpact));

  return {
    state: "ok",
    from: previous.overall, to: current.overall,
    change: previous.overall != null && current.overall != null ? current.overall - previous.overall : null,
    dimensions,
    topMovers: movers.slice(0, 3),
    notes,
  };
}
```

- [ ] **Step 4: Add exports to `index.ts`**

Append to `src/lib/financial-engine/index.ts`:

```ts
export * from "./score-types";
export * from "./metric-inputs";
export * from "./metrics";
export * from "./scoring";
export * from "./confidence";
export * from "./momentum-overlay";
export * from "./score-delta";
```

- [ ] **Step 5: Run the full engine suite**

Run: `pnpm vitest run src/lib/financial-engine/`
Expected: PASS — all engine tests including the two new files. Then run `pnpm test` (whole offline suite) — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/financial-engine/score-delta.ts src/lib/financial-engine/score-delta.test.ts src/lib/financial-engine/score-pipeline.test.ts src/lib/financial-engine/index.ts
git commit -m "feat(engine): score-delta explanations and full-pipeline test; export score modules"
```

---

### Task 7: Data layer — `getScoreData` + dashboard score summary

**Files:**
- Modify: `src/lib/data/queries.ts`

**Interfaces:**
- Consumes: everything exported in Task 6; `applyOverride`/`parseOverride`; existing row-select patterns in `queries.ts` (see `getReportData` for the effective-transaction mapping idiom).
- Produces:
  - `type ScoreRange = "30d" | "90d" | "1y" | "all"`
  - `getScoreData(supabase: SupabaseClient, range: ScoreRange): Promise<ScoreData>` where `ScoreData = { breakdown: ScoreBreakdown; delta: ScoreDelta; momentum: MomentumState; improvements: string[]; range: ScoreRange }`
  - `type ScoreSummary = { state: OverallState; overall: number | null; band: string | null; momentum: MomentumState; confidence: ScoreBreakdown["overallConfidence"] }`
  - `getDashboardData` return type gains `scoreSummary: ScoreSummary`.

No unit tests: `queries.ts` is `server-only` (untestable outside Next runtime — KNOWN_LIMITATIONS). Verification = `pnpm typecheck` + live browser QA in Tasks 8–11. Keep every helper below pure so nothing new needs the Next runtime.

- [ ] **Step 1: Add score data assembly to `queries.ts`**

Add after `getReportData` (reusing its fetch idiom — one query set, shared by both helpers below):

```ts
import {
  buildMetricInputs, computeMetrics, computeConfidence, computeScore,
  computeScoreDelta, computeMomentum, addDays,
  type MomentumState, type OverallState, type ScoreBreakdown, type ScoreDelta,
  type ScoreAccountInput, type ScoreTransactionInput,
} from "@/lib/financial-engine";

export type ScoreRange = "30d" | "90d" | "1y" | "all";

export interface ScoreSummary {
  state: OverallState;
  overall: number | null;
  band: string | null;
  momentum: MomentumState;
  confidence: ScoreBreakdown["overallConfidence"];
}

export interface ScoreData {
  breakdown: ScoreBreakdown;
  delta: ScoreDelta;
  momentum: MomentumState;
  improvements: string[];
  range: ScoreRange;
}

interface ScoreSourceRows {
  snapshots: DailySnapshot[];
  transactions: ScoreTransactionInput[];
  accounts: ScoreAccountInput[];
}

async function fetchScoreSources(supabase: SupabaseClient): Promise<ScoreSourceRows> {
  const [snapRes, txnRes, acctRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase
      .from("transactions")
      .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, user_override")
      .order("posted_date", { ascending: true }),
    supabase
      .from("financial_accounts")
      .select("id, type, institution, provider, current_balance, credit_limit, interest_rate, include_in_calculations, archived_at"),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (txnRes.error) throw txnRes.error;
  if (acctRes.error) throw acctRes.error;

  return {
    snapshots: (snapRes.data as SnapshotRow[]).map(rowToSnapshot),
    transactions: (txnRes.data as Array<TransactionRow & { description: string; user_override: unknown }>).map((row) => {
      const effective = applyOverride({
        id: row.id, accountId: row.account_id, postedDate: row.posted_date,
        amount: Number(row.amount), direction: row.direction as "inflow" | "outflow",
        description: row.description, category: row.category, essential: row.essential,
        isTransfer: row.is_transfer, transferPairId: row.transfer_pair_id,
        userOverride: parseOverride(row.user_override),
      });
      return {
        id: effective.id, accountId: effective.accountId, postedDate: effective.postedDate,
        amount: effective.amount, direction: effective.direction, category: effective.category,
        essential: effective.essential, isTransfer: effective.isTransfer,
        transferPairId: effective.transferPairId, description: effective.description,
      };
    }),
    accounts: (acctRes.data as Array<{
      id: string; type: string; institution: string | null; provider: string;
      current_balance: number | string; credit_limit: number | string | null;
      interest_rate: number | string | null; include_in_calculations: boolean;
      archived_at: string | null;
    }>)
      .filter((row) => row.archived_at === null)
      .map((row) => ({
        id: row.id,
        type: row.type as ScoreAccountInput["type"],
        institution: row.institution,
        currentBalance: Number(row.current_balance),
        creditLimit: row.credit_limit === null ? null : Number(row.credit_limit),
        interestRate: row.interest_rate === null ? null : Number(row.interest_rate),
        includeInCalculations: row.include_in_calculations,
        provider: row.provider,
      })),
  };
}

function breakdownAt(sources: ScoreSourceRows, asOf: string): ScoreBreakdown {
  const inputs = buildMetricInputs(sources.snapshots, sources.transactions, sources.accounts, asOf);
  const results = computeMetrics(inputs);
  const confidence = computeConfidence(inputs, results);
  return computeScore(results, confidence.byDimension, asOf);
}

function improvementsAt(sources: ScoreSourceRows, asOf: string): string[] {
  const inputs = buildMetricInputs(sources.snapshots, sources.transactions, sources.accounts, asOf);
  return computeConfidence(inputs, computeMetrics(inputs)).improvements;
}

const RANGE_DAYS: Record<Exclude<ScoreRange, "all">, number> = { "30d": 30, "90d": 90, "1y": 365 };

export async function getScoreData(supabase: SupabaseClient, range: ScoreRange): Promise<ScoreData> {
  const sources = await fetchScoreSources(supabase);
  const asOf = sources.snapshots.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const breakdown = breakdownAt(sources, asOf);

  const firstDate = sources.snapshots[0]?.date ?? asOf;
  const rangeStart = range === "all" ? firstDate : addDays(asOf, -RANGE_DAYS[range]);
  const previous = rangeStart < asOf && rangeStart >= firstDate ? breakdownAt(sources, rangeStart) : null;
  const delta = computeScoreDelta(breakdown, previous);

  const momentum = computeMomentum({
    current: breakdown.overall,
    prior30: breakdownAt(sources, addDays(asOf, -30)).overall,
    prior60: breakdownAt(sources, addDays(asOf, -60)).overall,
  });

  return { breakdown, delta, momentum, improvements: improvementsAt(sources, asOf), range };
}

export async function getScoreSummary(supabase: SupabaseClient): Promise<ScoreSummary> {
  const sources = await fetchScoreSources(supabase);
  const asOf = sources.snapshots.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const breakdown = breakdownAt(sources, asOf);
  const momentum = computeMomentum({
    current: breakdown.overall,
    prior30: breakdownAt(sources, addDays(asOf, -30)).overall,
    prior60: breakdownAt(sources, addDays(asOf, -60)).overall,
  });
  return {
    state: breakdown.state, overall: breakdown.overall, band: breakdown.band,
    momentum, confidence: breakdown.overallConfidence,
  };
}
```

Then extend `getDashboardData`'s return: add `scoreSummary: await getScoreSummary(supabase)` to its result object and `scoreSummary: ScoreSummary` to its return type. (One extra query round-trip is acceptable for v1; note it in KNOWN_LIMITATIONS in Task 10 as a batching opportunity.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (`getDashboardData` callers get the new field additively — no existing consumer breaks.)

- [ ] **Step 3: Run the offline suite**

Run: `pnpm test`
Expected: PASS — no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/queries.ts
git commit -m "feat(data): getScoreData/getScoreSummary read-time score assembly"
```

---

### Task 8: `/score` screen

**Files:**
- Create: `src/app/score/page.tsx`
- Create: `src/app/score/ScoreView.tsx`

**Interfaces:**
- Consumes: `getScoreData`, `getProfile`, `ScoreRange`; `Segmented`, `Card` components; `momentumLabel`.
- Produces: route `/score?range=30d|90d|1y|all` (default `90d`). Range switching navigates with `router.replace` + URL search params (same idiom as `/transactions` filters).

Design requirements (from the design spec — all must be visible in the UI):
- Overall score + band + momentum chip (`momentumLabel`, with ▲/▼/— glyph, never color alone) + confidence chip.
- Provisional state: overall shown with a visible "Provisional" tag + the note. Suppressed state: no number; show notes ("what would unlock your score").
- Delta section: "What changed" — from→to, per-dimension changes (signed, with +/− text), top movers with point impacts; `insufficient_history` renders as plain copy, not an error.
- Six dimension rows: label, score /100 or "Not enough data" + reason, confidence text chip; expandable (`<details>`) to metric list: name, formatted value, curve score, and a "How is this calculated?" disclosure showing `definition`, `assumptions`, `limitations`, and `reason` when unavailable.
- Protection row (separate, clearly unscored): "Protection — Not assessed. Not part of your score yet."
- Effective-weights disclosure when `state === "provisional"`; overall-confidence panel with `improvements` list.
- Mobile-first at ~390px; loading skeleton comes free via existing `src/app/loading.tsx`; error boundary via existing `src/app/error.tsx`.

- [ ] **Step 1: Write `page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getScoreData, type ScoreRange } from "@/lib/data/queries";
import { ScoreView } from "./ScoreView";

const RANGES: ScoreRange[] = ["30d", "90d", "1y", "all"];

export default async function ScorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");

  const sp = await searchParams;
  const range = RANGES.includes(sp.range as ScoreRange) ? (sp.range as ScoreRange) : "90d";
  const data = await getScoreData(supabase, range);

  return <ScoreView data={data} />;
}
```

- [ ] **Step 2: Write `ScoreView.tsx`**

Client component. Full structural skeleton (follow existing view components — e.g. `src/app/transactions/TransactionsView.tsx` — for styling-token and layout conventions; reuse `Card` and `Segmented` exactly as they are used there):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { momentumLabel, type ScoreBreakdown } from "@/lib/financial-engine";
import type { ScoreData, ScoreRange } from "@/lib/data/queries";

const RANGE_OPTIONS: Array<{ value: ScoreRange; label: string }> = [
  { value: "30d", label: "30D" }, { value: "90d", label: "90D" },
  { value: "1y", label: "1Y" }, { value: "all", label: "All" },
];

const MOMENTUM_GLYPH: Record<string, string> = {
  strongly_improving: "▲▲", improving: "▲", recovering: "▲",
  stable: "—", weakening: "▼", deteriorating: "▼▼", insufficient_history: "…",
};

const CONFIDENCE_COPY: Record<string, string> = {
  high: "High confidence", moderate: "Moderate confidence",
  limited: "Limited confidence", insufficient_data: "Not enough data",
};

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function ScoreView({ data }: { data: ScoreData }) {
  const router = useRouter();
  const { breakdown, delta, momentum, improvements, range } = data;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-lg font-semibold">PFI Score</h1>
        <p className="text-sm opacity-70">
          Measures your financial operating health. Not a credit score.
        </p>
      </header>

      {/* Overall */}
      <Card>
        {breakdown.state === "suppressed" ? (
          <div>
            <p className="text-base font-medium">Your score isn&apos;t available yet</p>
            {breakdown.notes.map((n) => <p key={n} className="mt-1 text-sm opacity-80">{n}</p>)}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold tabular-nums">{breakdown.overall}</span>
              <span className="text-sm opacity-70">/ 900 · {breakdown.band}</span>
              {breakdown.state === "provisional" && (
                <span className="rounded border px-1.5 py-0.5 text-xs">Provisional</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border px-2 py-0.5">
                {MOMENTUM_GLYPH[momentum]} {momentumLabel(momentum)}
              </span>
              <span className="rounded-full border px-2 py-0.5">
                {CONFIDENCE_COPY[breakdown.overallConfidence]}
              </span>
            </div>
            {breakdown.notes.map((n) => <p key={n} className="text-xs opacity-70">{n}</p>)}
          </div>
        )}
      </Card>

      {/* What changed */}
      <section aria-label="What changed">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">What changed</h2>
          <Segmented
            options={RANGE_OPTIONS.map((o) => o.label)}
            value={RANGE_OPTIONS.find((o) => o.value === range)!.label}
            onChange={(label) => {
              const next = RANGE_OPTIONS.find((o) => o.label === label)!.value;
              router.replace(`/score?range=${next}`);
            }}
          />
        </div>
        <Card>
          {delta.state === "insufficient_history" ? (
            <p className="text-sm opacity-80">{delta.notes.join(" ")}</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                {delta.change === 0 ? "No change" : `${signed(delta.change ?? 0)} points`}
                {" "}({delta.from} → {delta.to})
              </p>
              {delta.topMovers.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {delta.topMovers.map((m) => (
                    <li key={m.id} className="flex justify-between">
                      <span>{m.name}</span>
                      <span className="tabular-nums">{signed(m.overallPointsImpact)} pts</span>
                    </li>
                  ))}
                </ul>
              )}
              {delta.notes.map((n) => <p key={n} className="text-xs opacity-70">{n}</p>)}
            </div>
          )}
        </Card>
      </section>

      {/* Dimensions */}
      <section aria-label="Score dimensions" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">The six dimensions</h2>
        {breakdown.dimensions.map((d) => (
          <Card key={d.key}>
            <details>
              <summary className="flex cursor-pointer items-center justify-between gap-2">
                <span className="text-sm font-medium">{d.label}</span>
                <span className="flex items-center gap-2 text-sm">
                  {d.score !== null
                    ? <span className="tabular-nums">{d.score}<span className="opacity-60">/100</span></span>
                    : <span className="opacity-70">Not enough data</span>}
                  <span className="rounded-full border px-2 py-0.5 text-xs">{CONFIDENCE_COPY[d.confidence]}</span>
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-3 border-t pt-3">
                {!d.eligible && d.exclusionReason && (
                  <p className="text-sm opacity-80">{d.exclusionReason}</p>
                )}
                {d.metrics.map((m) => (
                  <div key={m.id} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{m.name}{!m.scored && <span className="ml-1 text-xs opacity-60">(context only)</span>}</span>
                      <span className="tabular-nums">
                        {m.availability === "available" ? m.formatted : m.reason}
                      </span>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs opacity-70">How is this calculated?</summary>
                      <div className="mt-1 flex flex-col gap-1 text-xs opacity-80">
                        <p>{m.definition}</p>
                        {m.scored && m.curveScore !== null && <p>Contributes {m.curveScore}/100 to {d.label}.</p>}
                        {m.assumptions.map((a) => <p key={a}>Assumes: {a}</p>)}
                        {m.limitations.map((l) => <p key={l}>Limitation: {l}</p>)}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            </details>
          </Card>
        ))}

        {/* Protection — visible, unscored */}
        <Card>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Protection</span>
            <span className="opacity-70">Not assessed</span>
          </div>
          <p className="mt-1 text-xs opacity-70">
            Insurance and estate readiness matter, but we don&apos;t guess from bank data.
            Protection is not part of your score yet.
          </p>
        </Card>
      </section>

      {/* Weights + confidence */}
      {breakdown.state === "provisional" && (
        <Card>
          <h2 className="text-sm font-medium">Weights used for this score</h2>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {breakdown.dimensions.filter((d) => d.eligible).map((d) => (
              <li key={d.key} className="flex justify-between">
                <span>{d.label}</span>
                <span className="tabular-nums">
                  {Math.round((breakdown.effectiveWeights[d.key] ?? 0) * 100)}%
                  <span className="opacity-60"> (normally {Math.round(d.configuredWeight * 100)}%)</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {improvements.length > 0 && (
        <Card>
          <h2 className="text-sm font-medium">What would improve accuracy</h2>
          <ul className="mt-2 list-disc pl-4 text-sm opacity-80">
            {improvements.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </Card>
      )}
    </main>
  );
}
```

Check `Segmented`'s actual props before using — if its API is `options: Array<{value,label}>`/`onChange(value)`, adapt the two call-site lines accordingly (do not modify `Segmented` itself).

- [ ] **Step 3: Build and verify manually**

Run: `pnpm typecheck && pnpm build`
Expected: clean; `/score` appears in the route map.

Run `pnpm dev`, log in as the dev/demo user, open `http://localhost:3000/score` at 390×844 and 1280×900. Verify: score renders; range switch updates delta; dimension rows expand with metric details and "How is this calculated?"; Protection row present; demo data shows Moderate confidence; console clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/score/
git commit -m "feat(ui): /score screen — breakdown, delta, momentum, protection, confidence"
```

---

### Task 9: Dashboard score card

**Files:**
- Create: `src/components/dashboard/ScoreCard.tsx`
- Modify: `src/components/dashboard/HomeDashboard.tsx` (render `ScoreCard`; accept the new `scoreSummary` prop)
- Modify: `src/app/page.tsx` (pass `scoreSummary` from `getDashboardData` — follow how existing dashboard props flow)

- [ ] **Step 1: Write `ScoreCard.tsx`**

```tsx
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { momentumLabel } from "@/lib/financial-engine";
import type { ScoreSummary } from "@/lib/data/queries";

const MOMENTUM_GLYPH: Record<string, string> = {
  strongly_improving: "▲▲", improving: "▲", recovering: "▲",
  stable: "—", weakening: "▼", deteriorating: "▼▼", insufficient_history: "…",
};

export function ScoreCard({ summary }: { summary: ScoreSummary }) {
  return (
    <Link href="/score" aria-label="Open PFI score details">
      <Card>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs opacity-70">PFI Score</p>
            {summary.state === "suppressed" ? (
              <p className="text-sm font-medium">Add data to unlock</p>
            ) : (
              <p className="text-2xl font-bold tabular-nums">
                {summary.overall}
                <span className="ml-1 text-xs font-normal opacity-60">/ 900 · {summary.band}</span>
                {summary.state === "provisional" && (
                  <span className="ml-2 rounded border px-1 py-0.5 text-[10px] font-normal align-middle">Provisional</span>
                )}
              </p>
            )}
          </div>
          <span className="rounded-full border px-2 py-0.5 text-xs">
            {MOMENTUM_GLYPH[summary.momentum]} {momentumLabel(summary.momentum)}
          </span>
        </div>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Wire it into `HomeDashboard.tsx` and `page.tsx`**

Add `scoreSummary` to `HomeDashboard`'s props and render `<ScoreCard summary={scoreSummary} />` directly beneath the index chart section (above the metric cards). In `src/app/page.tsx`, destructure `scoreSummary` from the `getDashboardData` result and pass it through. Match the file's existing prop-threading style exactly.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test && pnpm build` — all green.
In `pnpm dev`: dashboard shows the card at 390px and desktop; tapping navigates to `/score`; empty-state (fresh user, no demo data) shows the suppressed "Add data to unlock" card without crashing.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/ScoreCard.tsx src/components/dashboard/HomeDashboard.tsx src/app/page.tsx
git commit -m "feat(ui): dashboard PFI score card linking to /score"
```

---

### Task 10: Consumer-language relabel + docs

**Files:**
- Modify: `src/app/report/ReportView.tsx:123` ("Free cash flow" → "Monthly surplus") and `:128` ("Owner-created equity" → "Growth you created")
- Modify: `docs/CURRENT_PHASE.md` (Phase 2 slice completed section, next priorities), `README.md` (status + roadmap row for Phase 2), `docs/KNOWN_LIMITATIONS.md` (add: score summary runs a second query set on dashboard load — batching opportunity; DSR excludes housing by design; volatility metrics need 90 days)
- Test: existing `report.test.ts` must stay green (labels are UI-only; engine identifiers unchanged)

- [ ] **Step 1: Relabel the two `StatementRow` labels in `ReportView.tsx`** (values/semantics untouched — internal engine names stay `freeCashFlow`/`ownerCreatedEquity`).

- [ ] **Step 2: Update the three docs.** CURRENT_PHASE: move this slice into "Completed", set next priorities (CSV import, demo profiles, PWA). README: Phase 2 row → 🔨/✅ per actual state. KNOWN_LIMITATIONS: the three entries above.

- [ ] **Step 3: Run `pnpm test` (green) and commit**

```bash
git add src/app/report/ReportView.tsx docs/CURRENT_PHASE.md README.md docs/KNOWN_LIMITATIONS.md
git commit -m "docs+copy: consumer-language report labels; Phase 2 status updates"
```

---

### Task 11: Final verification

- [ ] **Step 1:** `pnpm check` — lint + typecheck + test + build, all green. Fix anything that isn't; re-run until green.
- [ ] **Step 2:** Live browser QA (gstack `browse` or manual) at 390×844 and 1280×900, logged in with demo data: dashboard card → `/score`; all four ranges; expand every dimension; "How is this calculated?" on at least three metrics; Protection row; fresh-user suppressed state (clear demo data); console clean on `/` and `/score`.
- [ ] **Step 3:** Verify spec conformance one last time: weights in `scoring.ts` vs FINANCIAL_HEALTH_SCORE.md tables; every curve anchor matches; `PFI_SCORE_VERSION === "1.0"`. Any mismatch: fix code or spec together in one commit.
- [ ] **Step 4:** Update `docs/CURRENT_PHASE.md` test-status line with the new totals; commit any final fixes.

```bash
git add -A && git commit -m "chore: Phase 2 score slice — final verification pass"
```
