import { describe, expect, it } from "vitest";
import { clampPercent, formatOrdinal, markerXFraction, railPositions } from "./math";

describe("clampPercent", () => {
  it("clamps into 0..100", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(34)).toBe(34);
    expect(clampPercent(140)).toBe(100);
  });
});

describe("markerXFraction", () => {
  it("maps an index into 0..1 across the range", () => {
    expect(markerXFraction(0, 30)).toBe(0);
    expect(markerXFraction(29, 30)).toBe(1);
    expect(markerXFraction(14, 29)).toBe(0.5);
  });
  it("centers when there is one or zero points", () => {
    expect(markerXFraction(0, 1)).toBe(0.5);
    expect(markerXFraction(0, 0)).toBe(0.5);
  });
});

describe("railPositions", () => {
  it("maps values to top-percentages (max → 0, min → 100)", () => {
    expect(railPositions([80, 100, 90], 80, 100, 0)).toEqual([100, 0, 50]);
  });
  it("passes nulls through", () => {
    expect(railPositions([100, null, 80], 80, 100, 0)).toEqual([0, null, 100]);
  });
  it("nudges labels apart to enforce a minimum gap, preserving order", () => {
    const out = railPositions([100, 99.5, 80], 80, 100, 10) as number[];
    expect(out[1] - out[0]).toBeGreaterThanOrEqual(10);
    expect(out[2]).toBe(100);
    expect(out[0]).toBeLessThan(out[1]);
  });
  it("handles a flat domain without NaN", () => {
    expect(railPositions([5, 5], 5, 5, 0)).toEqual([50, 50]);
  });
});

describe("formatOrdinal", () => {
  it("formats English ordinals including teens", () => {
    expect(formatOrdinal(1)).toBe("1st");
    expect(formatOrdinal(72)).toBe("72nd");
    expect(formatOrdinal(34)).toBe("34th");
    expect(formatOrdinal(87)).toBe("87th");
    expect(formatOrdinal(11)).toBe("11th");
    expect(formatOrdinal(112)).toBe("112th");
    expect(formatOrdinal(103)).toBe("103rd");
  });
});
