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
