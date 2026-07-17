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
    if (x <= x1) return Math.round((y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)) * 1e10) / 1e10;
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
