import type { MomentumState } from "./score-types";

export type DivergenceDirection = "index_down_score_up" | "index_up_score_down";

export interface DivergenceResult {
  direction: DivergenceDirection;
  scoreMomentum: MomentumState;
}

/** +1 up, -1 down, 0 no clear direction (never clashes). */
function scoreSign(m: MomentumState): 1 | -1 | 0 {
  switch (m) {
    case "strongly_improving":
    case "improving":
    case "recovering":
      return 1;
    case "weakening":
    case "deteriorating":
      return -1;
    default:
      return 0; // stable, insufficient_history
  }
}

/**
 * Detects an on-screen sign clash between the PFI header "Today" delta and the
 * Fundamentals Score momentum chip. Returns null unless the two point in
 * opposite, non-neutral directions. This is the single authority — both the
 * template sentence and the AI narration input derive from its result.
 */
export function computeDivergence(
  indexTodayPoints: number | null,
  scoreMomentum: MomentumState,
): DivergenceResult | null {
  const indexSign = indexTodayPoints == null || indexTodayPoints === 0 ? 0 : indexTodayPoints > 0 ? 1 : -1;
  const scoreS = scoreSign(scoreMomentum);
  if (indexSign === 0 || scoreS === 0 || indexSign === scoreS) return null;
  return {
    direction: indexSign < 0 ? "index_down_score_up" : "index_up_score_down",
    scoreMomentum,
  };
}
