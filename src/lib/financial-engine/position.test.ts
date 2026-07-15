import { describe, expect, it } from "vitest";
import { availablePosition, cushion, waterline } from "./position";
import type { DailySnapshot } from "./types";

const snapshot = (overrides: Partial<DailySnapshot> = {}): DailySnapshot => ({
  date: "2026-07-15",
  liquidAssets: 10_000,
  revolvingBalances: 2_000,
  nearTermObligations: 3_000,
  essentialObligations: 2_200,
  safetyBuffer: 1_500,
  netWorth: 250_000,
  ...overrides,
});

describe("availablePosition", () => {
  it("is liquid minus revolving minus near-term obligations", () => {
    expect(availablePosition(snapshot())).toBe(5_000);
  });

  it("can be negative when obligations exceed liquid assets", () => {
    expect(availablePosition(snapshot({ liquidAssets: 1_000 }))).toBe(-4_000);
  });
});

describe("waterline", () => {
  it("is essential obligations plus safety buffer", () => {
    expect(waterline(snapshot())).toBe(3_700);
  });
});

describe("cushion", () => {
  it("is available position minus waterline", () => {
    expect(cushion(snapshot())).toBe(1_300);
  });

  it("distinguishes below-baseline from underwater: cushion can stay positive while position drops", () => {
    // Position falls but remains above the waterline — below average ≠ underwater.
    const s = snapshot({ liquidAssets: 9_000 });
    expect(availablePosition(s)).toBe(4_000);
    expect(cushion(s)).toBe(300);
  });
});
