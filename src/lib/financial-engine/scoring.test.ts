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
