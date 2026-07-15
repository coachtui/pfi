import type { DailySnapshot, IndexAnchor, IndexPoint } from "./types";
import { availablePosition, waterline } from "./position";

/**
 * Personal financial index.
 *
 * Naive formula (current / starting × 100) explodes when the starting
 * position is negative, zero, or tiny. Instead we use an offset-based
 * mapping that degrades to the naive formula in the healthy case:
 *
 *   index(v) = 100 + 100 × (v − A) / S
 *
 *   A (anchor) = median available position over the first 30 days
 *   S (scale)  = max(|A|, medianAbs × MIN_SCALE_RATIO, MIN_SCALE_DOLLARS)
 *
 * When A > 0 and S = A this reduces exactly to v / A × 100. When A ≤ 0 or
 * near zero, the scale floor keeps the index continuous and bounded.
 * Full reasoning: docs/FINANCIAL_INDEX_METHODOLOGY.md.
 */

const ANCHOR_WINDOW_DAYS = 30;
const MIN_SCALE_DOLLARS = 1_000;
const MIN_SCALE_RATIO = 0.25;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Derive the anchor (A) and scale (S) from a snapshot history, oldest first. */
export function deriveAnchor(snapshots: DailySnapshot[]): IndexAnchor {
  if (snapshots.length === 0) {
    return { anchorValue: 0, scale: MIN_SCALE_DOLLARS, method: "insufficient-history" };
  }
  const positions = snapshots.map(availablePosition);
  const windowed = positions.slice(0, ANCHOR_WINDOW_DAYS);
  const method =
    positions.length >= ANCHOR_WINDOW_DAYS ? "median-first-30-days" : "median-full-history";
  const anchorValue = median(windowed);
  const medianAbs = median(positions.map(Math.abs));
  const scale = Math.max(Math.abs(anchorValue), medianAbs * MIN_SCALE_RATIO, MIN_SCALE_DOLLARS);
  return { anchorValue, scale, method };
}

/** Map a dollar value into index space using a derived anchor. */
export function toIndex(dollars: number, anchor: IndexAnchor): number {
  return 100 + (100 * (dollars - anchor.anchorValue)) / anchor.scale;
}

/**
 * Personal baseline: trailing rolling average of the indexed actual series.
 * Deliberately simple and explainable for v1 (no ML). Returns null until
 * `minPeriods` days of history exist.
 */
export function rollingBaseline(
  values: number[],
  windowDays = 30,
  minPeriods = 7,
): Array<number | null> {
  return values.map((_, i) => {
    const start = Math.max(0, i - windowDays + 1);
    const window = values.slice(start, i + 1);
    if (window.length < minPeriods) return null;
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  });
}

/**
 * Build the full indexed chart series (actual, baseline, waterline) from a
 * snapshot history, oldest first. The same anchor maps all three lines so
 * they are directly comparable on one axis.
 */
export function buildIndexSeries(snapshots: DailySnapshot[]): {
  points: IndexPoint[];
  anchor: IndexAnchor;
} {
  const anchor = deriveAnchor(snapshots);
  const actuals = snapshots.map((s) => toIndex(availablePosition(s), anchor));
  const baselines = rollingBaseline(actuals);
  const points = snapshots.map((s, i) => ({
    date: s.date,
    actual: round2(actuals[i]),
    baseline: baselines[i] === null ? null : round2(baselines[i] as number),
    waterline: round2(toIndex(waterline(s), anchor)),
  }));
  return { points, anchor };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
