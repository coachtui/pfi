import { describe, expect, it } from "vitest";
import type { DailySnapshot, TransactionInput, ScoreTransactionInput, ScoreAccountInput } from "@/lib/financial-engine";
import { computeReportLive, computeMetricLive } from "./concept-live";

// Minimal casts: computeReportLive only touches snapshot date/liquidAssets/
// revolvingBalances/nearTermObligations and transaction postedDate/amount/
// direction/category/isTransfer for the revenue field.
const snap = (date: string): DailySnapshot =>
  ({ date, liquidAssets: 1000, revolvingBalances: 0, nearTermObligations: 0 }) as DailySnapshot;
const income = (postedDate: string, amount: number): TransactionInput =>
  ({ postedDate, amount, direction: "inflow", category: "income", isTransfer: false }) as TransactionInput;

// April–June; June ends on a month boundary so it is the latest complete period.
const SNAPSHOTS = ["2026-04-01", "2026-04-30", "2026-05-31", "2026-06-30"].map(snap);

// Fixture for computeMetricLive's positive path, adapted from
// src/lib/financial-engine/metrics.test.ts's healthyFixture()/ACCOUNTS —
// already proven to make recurring_surplus, liquid_runway_months, and
// debt_service_ratio all resolve to availability: "available".
const METRIC_ACCOUNTS: ScoreAccountInput[] = [
  { id: "chk", type: "checking", institution: "First Bank", currentBalance: 9000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "sav", type: "savings", institution: "Ally", currentBalance: 6000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "card", type: "credit_card", institution: "First Bank", currentBalance: 3000, creditLimit: 10000, interestRate: 0.24, includeInCalculations: true, provider: "manual" },
];

function metricSnap(date: string, liquid: number): DailySnapshot {
  return { date, liquidAssets: liquid, revolvingBalances: 3000, nearTermObligations: 3000, essentialObligations: 2000, safetyBuffer: 1000, netWorth: 12000 } as DailySnapshot;
}

/** ~4 months of history: monthly payroll, rent, groceries, a card payment transfer. Mirrors metrics.test.ts's healthyFixture. */
function metricFixture(): { snapshots: DailySnapshot[]; txns: ScoreTransactionInput[] } {
  const txns: ScoreTransactionInput[] = [];
  const snapshots: DailySnapshot[] = [];
  const base = { accountId: "chk", category: null as string | null, essential: null as boolean | null, isTransfer: false, transferPairId: null as string | null, description: "" };
  const months = ["2026-04", "2026-05", "2026-06", "2026-07"];
  months.forEach((m, i) => {
    txns.push({ ...base, id: `pay${i}`, postedDate: `${m}-01`, amount: 6000, direction: "inflow", category: "income", description: "Employer payroll" });
    txns.push({ ...base, id: `rent${i}`, postedDate: `${m}-02`, amount: 1800, direction: "outflow", category: "housing", essential: true });
    txns.push({ ...base, id: `gro${i}`, postedDate: `${m}-10`, amount: 700, direction: "outflow", category: "groceries", essential: true });
  });
  for (let d = 0; d < 106; d++) {
    const date = new Date(Date.UTC(2026, 3, 1 + d)).toISOString().slice(0, 10);
    if (date > "2026-07-15") break;
    snapshots.push(metricSnap(date, 12000 + d * 20));
  }
  return { snapshots, txns };
}

describe("computeReportLive", () => {
  it("resolves current and prior monthly figures for report:revenue", () => {
    const live = computeReportLive(
      "report:revenue",
      SNAPSHOTS,
      [income("2026-05-15", 5800), income("2026-06-15", 6200)],
      [],
    );
    expect(live).not.toBeNull();
    expect(live!.display).toMatch(/6,?200/);
    expect(live!.priorDisplay).toMatch(/5,?800/);
    expect(live!.deltaDisplay).toMatch(/^\+/);
    expect(live!.deltaDisplay).toContain("vs");
  });

  it("returns null for non-report namespaces and unknown fields", () => {
    expect(computeReportLive("metric:liquid_runway_months", SNAPSHOTS, [], [])).toBeNull();
    expect(computeReportLive("report:nope", SNAPSHOTS, [], [])).toBeNull();
  });

  it("returns null with no snapshots", () => {
    expect(computeReportLive("report:revenue", [], [], [])).toBeNull();
  });
});

describe("computeMetricLive", () => {
  it("returns null for a non-metric namespace", () => {
    expect(computeMetricLive("report:revenue", SNAPSHOTS, [], [])).toBeNull();
  });

  it("returns null for an unknown metric id", () => {
    expect(computeMetricLive("metric:not_a_metric", SNAPSHOTS, [], [])).toBeNull();
  });

  it("returns null when the metric is unavailable (no income)", () => {
    // liquid_runway_months is unavailable with no essential spend / income context.
    expect(computeMetricLive("metric:liquid_runway_months", [], [], [])).toBeNull();
  });

  it("resolves current and prior monthly figures for metric:recurring_surplus", () => {
    const { snapshots, txns } = metricFixture();
    const live = computeMetricLive("metric:recurring_surplus", snapshots, txns, METRIC_ACCOUNTS);
    expect(live).not.toBeNull();
    // recurring_surplus = $6,000 payroll − $1,800 rent − $700 groceries = $3,500,
    // identical for both June (current) and May (prior) in this fixture, so
    // the delta is a flat $0 vs May — still a real "+" (delta >= 0) result.
    expect(live!.periodLabel).toBe("June 2026");
    expect(live!.display).toBe("$3,500");
    expect(live!.priorLabel).toBe("May 2026");
    expect(live!.priorDisplay).toBe("$3,500");
    expect(live!.deltaDisplay).toContain("vs May 2026");
    expect(live!.deltaDisplay).toMatch(/^\+/);
  });
});
