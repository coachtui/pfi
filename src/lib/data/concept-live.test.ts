import { describe, expect, it } from "vitest";
import type { DailySnapshot, TransactionInput, ScoreTransactionInput, ScoreAccountInput } from "@/lib/financial-engine";
import { computeReportLive, computeMetricLive, computeSnapshotLive, computeConceptLive } from "./concept-live";

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
  // Groceries vary by month (April 750 / May 700 / June 900 / July 900) so the
  // resolved delta between any two adjacent periods is genuinely non-zero and
  // sign-meaningful, instead of every month netting to an identical $3,500.
  const GROCERIES_BY_MONTH = [750, 700, 900, 900];
  months.forEach((m, i) => {
    txns.push({ ...base, id: `pay${i}`, postedDate: `${m}-01`, amount: 6000, direction: "inflow", category: "income", description: "Employer payroll" });
    txns.push({ ...base, id: `rent${i}`, postedDate: `${m}-02`, amount: 1800, direction: "outflow", category: "housing", essential: true });
    txns.push({ ...base, id: `gro${i}`, postedDate: `${m}-10`, amount: GROCERIES_BY_MONTH[i], direction: "outflow", category: "groceries", essential: true });
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

  it("resolves current and prior monthly figures for metric:recurring_surplus, with a genuine sign-verified delta", () => {
    const { snapshots, txns } = metricFixture();
    const live = computeMetricLive("metric:recurring_surplus", snapshots, txns, METRIC_ACCOUNTS);
    expect(live).not.toBeNull();
    // recurring_surplus is the median of three 30-day-bucket (income − spending)
    // nets within a trailing 90-day window ending at each period's boundary —
    // NOT a naive per-calendar-month subtraction. Because payroll posts on the
    // 1st while rent/groceries post on the 2nd/10th, a payroll transaction can
    // land a whole bucket away from its own month's other transactions (e.g.
    // May's payroll falls in the *older* bucket alongside April's rent and
    // groceries once June is the "current" period). So June's/May's real
    // figures below were confirmed against actual computeMetricLive output,
    // not hand-derived from the raw $6,000/$1,800/groceries amounts — see
    // GROCERIES_BY_MONTH above for the perturbation that drives them.
    expect(live!.periodLabel).toBe("June 2026");
    expect(live!.display).toBe("$3,300");
    expect(live!.priorLabel).toBe("May 2026");
    expect(live!.priorDisplay).toBe("$3,450");
    // June's surplus is genuinely lower than May's here, so the delta must
    // take the "−" (negative) branch — the one a reversed-operand
    // (prior − current) bug would flip to a wrong "+" without failing the
    // old flat-$0 fixture. Uses the code's actual minus glyph (U+2212 "−",
    // not ASCII "-").
    expect(live!.deltaDisplay).toBe("−$150 vs May 2026");
  });
});

const snapNet = (date: string, netWorth: number): DailySnapshot =>
  ({ date, liquidAssets: 0, revolvingBalances: 0, nearTermObligations: 0, netWorth }) as DailySnapshot;

describe("computeSnapshotLive", () => {
  it("resolves current and prior net worth for snapshot:netWorth with positive delta", () => {
    const snaps = [
      snapNet("2026-04-30", 100000),
      snapNet("2026-05-31", 108000),
      snapNet("2026-06-30", 112000),
    ];
    const live = computeSnapshotLive("snapshot:netWorth", snaps);
    expect(live).not.toBeNull();
    expect(live!.display).toMatch(/112,?000/);
    expect(live!.priorDisplay).toMatch(/108,?000/);
    expect(live!.deltaDisplay).toBe("+$4,000 vs May 2026");
  });

  it("resolves current and prior net worth for snapshot:netWorth with negative delta", () => {
    const snaps = [
      snapNet("2026-04-30", 112000),
      snapNet("2026-05-31", 108000),
      snapNet("2026-06-30", 100000),
    ];
    const live = computeSnapshotLive("snapshot:netWorth", snaps);
    expect(live).not.toBeNull();
    expect(live!.display).toMatch(/100,?000/);
    expect(live!.priorDisplay).toMatch(/108,?000/);
    expect(live!.deltaDisplay).toBe("−$8,000 vs May 2026");
  });

  it("returns null for the wrong namespace/field and for empty snapshots", () => {
    expect(computeSnapshotLive("snapshot:liquidAssets", [snapNet("2026-06-30", 1)])).toBeNull();
    expect(computeSnapshotLive("snapshot:netWorth", [])).toBeNull();
  });
});

describe("computeConceptLive (dispatch)", () => {
  it("routes report:revenue to computeReportLive and returns its real current/prior values", () => {
    // Same SNAPSHOTS + income() transactions the computeReportLive describe
    // block proves directly above — reused here so a match confirms the
    // dispatcher's `report` branch genuinely calls computeReportLive, not
    // just that it doesn't crash.
    const data = {
      snapshots: SNAPSHOTS,
      // computeReportLive only reads postedDate/amount/direction/category/
      // isTransfer, all of which income() sets — minimal cast per the
      // file-level comment above.
      transactions: [income("2026-05-15", 5800), income("2026-06-15", 6200)] as unknown as ScoreTransactionInput[],
      accounts: [] as ScoreAccountInput[],
      events: [],
    };
    const live = computeConceptLive("report:revenue", data);
    expect(live).not.toBeNull();
    expect(live!.display).toMatch(/6,?200/);
    expect(live!.priorDisplay).toMatch(/5,?800/);
  });

  it("routes metric:recurring_surplus to computeMetricLive and returns its real current/prior/delta values", () => {
    // Same metricFixture()/METRIC_ACCOUNTS the computeMetricLive describe
    // block proves directly above — reused so a match confirms the
    // dispatcher's `metric` branch genuinely calls computeMetricLive with
    // real data, not just that an invalid id returns null.
    const { snapshots, txns } = metricFixture();
    const data = { snapshots, transactions: txns, accounts: METRIC_ACCOUNTS, events: [] };
    const live = computeConceptLive("metric:recurring_surplus", data);
    expect(live).not.toBeNull();
    expect(live!.display).toBe("$3,300");
    expect(live!.priorDisplay).toBe("$3,450");
    expect(live!.deltaDisplay).toBe("−$150 vs May 2026");
  });

  it("routes snapshot:netWorth to computeSnapshotLive and returns its real current/prior values", () => {
    const snaps = [snapNet("2026-04-30", 100000), snapNet("2026-05-31", 108000), snapNet("2026-06-30", 112000)];
    const data = { snapshots: snaps, transactions: [] as ScoreTransactionInput[], accounts: [] as ScoreAccountInput[], events: [] };
    const live = computeConceptLive("snapshot:netWorth", data);
    expect(live).not.toBeNull();
    expect(live!.display).toMatch(/112,?000/);
    expect(live!.priorDisplay).toMatch(/108,?000/);
  });

  it("returns null for an unknown metric id and for an unsupported namespace", () => {
    // Negative controls: distinct code paths inside the dispatcher both land
    // on null (one via computeMetricLive rejecting an unknown id, the other
    // via the dispatcher's own catch-all) — kept alongside, not instead of,
    // the positive per-namespace checks above.
    const snaps = [snapNet("2026-04-30", 100000), snapNet("2026-05-31", 108000), snapNet("2026-06-30", 112000)];
    const data = { snapshots: snaps, transactions: [] as ScoreTransactionInput[], accounts: [] as ScoreAccountInput[], events: [] };
    expect(computeConceptLive("metric:not_a_metric", data)).toBeNull();            // → computeMetricLive (unknown id)
    expect(computeConceptLive("position:availablePosition", data)).toBeNull();     // unsupported namespace
  });
});
