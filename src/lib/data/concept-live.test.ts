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

// Helpers for computeMetricLive: liquid_runway_months → "N.N mo"; recurring_surplus → "$N"; debt_service_ratio → "NN%".
const scoreTxn = (postedDate: string, amount: number, direction: "inflow" | "outflow", category: string): ScoreTransactionInput =>
  ({ postedDate, amount, direction, category, isTransfer: false, description: category }) as ScoreTransactionInput;

// April–June; June ends on a month boundary so it is the latest complete period.
const SNAPSHOTS = ["2026-04-01", "2026-04-30", "2026-05-31", "2026-06-30"].map(snap);

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
});
