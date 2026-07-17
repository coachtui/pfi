import { describe, expect, it } from "vitest";
import type { ConfidenceLevel, DimensionKey, MetricResult } from "./score-types";
import type { FinancialEvent } from "./types";
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

  it("flags one-time events in the period as a single note", () => {
    const previous = computeScore(resultsWith({}), HIGH, "2026-06-15");
    const current = computeScore(resultsWith({}), HIGH, "2026-07-15");
    const events: FinancialEvent[] = [
      { id: "e1", date: "2026-07-01", type: "bonus", label: "Holiday bonus", amount: 2000, direction: "inflow" },
      // recurring/ordinary event types are not one-time and must not appear in the note
      { id: "e2", date: "2026-07-05", type: "paycheck", label: "Paycheck", amount: 3000, direction: "inflow" },
    ];
    const delta = computeScoreDelta(current, previous, events);
    const note = delta.notes.find((n) => n.startsWith("One-time events in this period:"));
    expect(note).toBeDefined();
    expect(note).toContain("Holiday bonus ($2,000)");
    expect(note).not.toContain("Paycheck");
  });

  it("adds no one-time-events note when there are no events", () => {
    const previous = computeScore(resultsWith({}), HIGH, "2026-06-15");
    const current = computeScore(resultsWith({}), HIGH, "2026-07-15");
    const delta = computeScoreDelta(current, previous, []);
    expect(delta.notes.some((n) => n.startsWith("One-time events in this period:"))).toBe(false);
  });

  it("ignores events on the insufficient_history path", () => {
    const current = computeScore(resultsWith({}), HIGH, "2026-07-15");
    const events: FinancialEvent[] = [
      { id: "e1", date: "2026-07-01", type: "bonus", label: "Holiday bonus", amount: 2000, direction: "inflow" },
    ];
    const delta = computeScoreDelta(current, null, events);
    expect(delta.state).toBe("insufficient_history");
    expect(delta.notes.some((n) => n.startsWith("One-time events in this period:"))).toBe(false);
  });
});
