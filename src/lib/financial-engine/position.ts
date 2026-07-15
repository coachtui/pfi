import type { DailySnapshot } from "./types";

/**
 * Available Financial Position (v1):
 *   liquid cash − revolving balances − obligations due before next income.
 *
 * This is the core dollar quantity everything else (index, baseline,
 * waterline comparisons) is derived from. See docs/FINANCIAL_INDEX_METHODOLOGY.md.
 */
export function availablePosition(s: DailySnapshot): number {
  return s.liquidAssets - s.revolvingBalances - s.nearTermObligations;
}

/**
 * Waterline (v1): essential obligations before next income + safety buffer.
 * The minimum available position required to stay out of financial pressure.
 */
export function waterline(s: DailySnapshot): number {
  return s.essentialObligations + s.safetyBuffer;
}

/** Cushion: how far the available position sits above the waterline, in dollars. */
export function cushion(s: DailySnapshot): number {
  return availablePosition(s) - waterline(s);
}
