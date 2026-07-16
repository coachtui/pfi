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
