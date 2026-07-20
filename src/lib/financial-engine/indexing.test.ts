import { describe, expect, it } from "vitest";
import { buildIndexSeries, deriveAnchor, indexDayChange, rollingBaseline, toIndex } from "./indexing";
import type { DailySnapshot } from "./types";

/** Build a snapshot whose available position equals `position` exactly. */
const snapAt = (date: string, position: number): DailySnapshot => ({
  date,
  liquidAssets: position,
  revolvingBalances: 0,
  nearTermObligations: 0,
  essentialObligations: 1_000,
  safetyBuffer: 500,
  netWorth: position,
});

const series = (positions: number[]): DailySnapshot[] =>
  positions.map((p, i) => snapAt(`2026-01-${String(i + 1).padStart(2, "0")}`, p));

describe("deriveAnchor", () => {
  it("uses the median of the first 30 days when enough history exists", () => {
    const positions = Array.from({ length: 60 }, (_, i) => 5_000 + i * 10);
    const anchor = deriveAnchor(series(positions.slice(0, 28)).concat(series(positions.slice(28))));
    expect(anchor.method).toBe("median-first-30-days");
    // median of first 30 values (5000..5290 step 10) = 5145
    expect(anchor.anchorValue).toBe(5_145);
  });

  it("falls back to full-history median with short history", () => {
    const anchor = deriveAnchor(series([4_000, 5_000, 6_000]));
    expect(anchor.method).toBe("median-full-history");
    expect(anchor.anchorValue).toBe(5_000);
  });

  it("handles empty history without crashing", () => {
    const anchor = deriveAnchor([]);
    expect(anchor.method).toBe("insufficient-history");
    expect(anchor.scale).toBeGreaterThan(0);
  });

  it("enforces a scale floor for near-zero starting positions (no index explosion)", () => {
    const anchor = deriveAnchor(series([5, -5, 10, 2, -8]));
    expect(anchor.scale).toBeGreaterThanOrEqual(1_000);
    // A $50 move should not swing the index by hundreds of points.
    const swing = Math.abs(toIndex(50, anchor) - toIndex(0, anchor));
    expect(swing).toBeLessThan(10);
  });

  it("handles users starting below zero: index stays finite and ordered", () => {
    const anchor = deriveAnchor(series([-3_000, -2_800, -3_200]));
    const worse = toIndex(-4_000, anchor);
    const better = toIndex(-1_000, anchor);
    expect(Number.isFinite(worse)).toBe(true);
    expect(better).toBeGreaterThan(worse);
    expect(toIndex(anchor.anchorValue, anchor)).toBe(100);
  });

  it("reduces to the naive current/start formula for a healthy positive anchor", () => {
    const anchor = deriveAnchor(series(Array(30).fill(10_000)));
    expect(anchor.anchorValue).toBe(10_000);
    expect(anchor.scale).toBe(10_000);
    expect(toIndex(12_000, anchor)).toBeCloseTo(120);
    expect(toIndex(5_000, anchor)).toBeCloseTo(50);
  });
});

describe("rollingBaseline", () => {
  it("returns null until minimum periods accumulate", () => {
    const result = rollingBaseline([1, 2, 3, 4, 5, 6, 7, 8], 30, 7);
    expect(result.slice(0, 6).every((v) => v === null)).toBe(true);
    expect(result[6]).toBeCloseTo(4); // mean of 1..7
    expect(result[7]).toBeCloseTo(4.5); // mean of 1..8
  });

  it("uses only the trailing window", () => {
    const values = Array(40).fill(0).concat(Array(30).fill(100));
    const result = rollingBaseline(values, 30, 7);
    expect(result[69]).toBeCloseTo(100); // window fully inside the 100s
  });
});

describe("buildIndexSeries", () => {
  it("maps actual, baseline, and waterline through the same anchor", () => {
    const snapshots = series(Array(40).fill(10_000));
    const { points, anchor } = buildIndexSeries(snapshots);
    expect(points).toHaveLength(40);
    expect(points[39].actual).toBeCloseTo(100);
    expect(points[39].baseline).toBeCloseTo(100);
    // waterline = 1500 dollars → indexed relative to the 10k anchor
    expect(points[39].waterline).toBeCloseTo(toIndex(1_500, anchor), 1);
  });
});

describe("indexDayChange", () => {
  it("returns point delta and percent for a normal day-over-day move", () => {
    const change = indexDayChange(104.2, 102.9);
    expect(change.points).toBeCloseTo(1.3, 10);
    expect(change.pct).toBeCloseTo((1.3 / 102.9) * 100, 10);
  });

  it("uses the absolute previous value as the percent denominator", () => {
    const change = indexDayChange(-90, -100);
    expect(change.points).toBeCloseTo(10, 10);
    expect(change.pct).toBeCloseTo(10, 10);
  });

  it("returns null pct (but real points) when previous is exactly 0", () => {
    const change = indexDayChange(4.2, 0);
    expect(change.points).toBeCloseTo(4.2, 10);
    expect(change.pct).toBeNull();
  });

  it("returns all-null when there is no previous point", () => {
    expect(indexDayChange(104.2, undefined)).toEqual({ points: null, pct: null });
  });
});
