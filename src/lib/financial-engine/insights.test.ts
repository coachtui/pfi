import { describe, expect, it } from "vitest";
import { computeDrivers, computeMomentum, computeStatus, driverDisplay } from "./insights";
import type { DailySnapshot, FinancialEvent } from "./types";

const event = (overrides: Partial<FinancialEvent>): FinancialEvent => ({
  id: "e1",
  date: "2026-07-10",
  type: "paycheck",
  label: "Paycheck",
  amount: 3_200,
  direction: "inflow",
  ...overrides,
});

describe("computeDrivers", () => {
  const events: FinancialEvent[] = [
    event({ id: "a", date: "2026-07-01", amount: 3_200, direction: "inflow" }),
    event({ id: "b", date: "2026-07-05", type: "mortgage_payment", amount: 2_850, direction: "outflow" }),
    event({ id: "c", date: "2026-07-12", type: "investment_contribution", amount: 500, direction: "outflow" }),
    event({ id: "d", date: "2026-06-01", amount: 9_999, direction: "inflow" }), // out of range
  ];

  it("filters to the range and sorts by absolute impact", () => {
    const drivers = computeDrivers(events, { start: "2026-07-01", end: "2026-07-15" });
    expect(drivers.map((d) => d.event.id)).toEqual(["a", "b", "c"]);
    expect(drivers[1].impact).toBe(-2_850);
  });

  it("respects the limit", () => {
    const drivers = computeDrivers(events, { start: "2026-07-01", end: "2026-07-15" }, 2);
    expect(drivers).toHaveLength(2);
  });
});

describe("driverDisplay", () => {
  it("shows inflows as positive", () => {
    const d = driverDisplay({ event: event({}), impact: 3_200 });
    expect(d.displayAmount).toBe(3_200);
    expect(d.tone).toBe("positive");
  });

  it("shows plain outflows as negative", () => {
    const d = driverDisplay({
      event: event({ type: "insurance_payment", direction: "outflow" }),
      impact: -210,
    });
    expect(d.displayAmount).toBe(-210);
    expect(d.tone).toBe("negative");
  });

  it("presents investment contributions as equity-positive despite negative cash impact", () => {
    const d = driverDisplay({
      event: event({ type: "investment_contribution", direction: "outflow" }),
      impact: -500,
    });
    expect(d.displayAmount).toBe(500);
    expect(d.tone).toBe("positive");
    expect(d.buildsEquity).toBe(true);
  });
});

describe("computeMomentum", () => {
  it("is stable with insufficient history", () => {
    expect(computeMomentum([100, 101]).direction).toBe("stable");
  });

  it("detects improvement beyond the noise band", () => {
    const values = Array(7).fill(100).concat(Array(7).fill(105));
    const m = computeMomentum(values);
    expect(m.direction).toBe("improving");
    expect(m.delta).toBe(5);
  });

  it("detects decline", () => {
    const values = Array(7).fill(100).concat(Array(7).fill(95));
    expect(computeMomentum(values).direction).toBe("declining");
  });

  it("treats small drift as stable", () => {
    const values = Array(7).fill(100).concat(Array(7).fill(100.5));
    expect(computeMomentum(values).direction).toBe("stable");
  });
});

describe("computeStatus", () => {
  const snapshot: DailySnapshot = {
    date: "2026-07-15",
    liquidAssets: 8_000,
    revolvingBalances: 1_000,
    nearTermObligations: 2_000,
    essentialObligations: 1_800,
    safetyBuffer: 1_500,
    netWorth: 100_000,
  };
  // available = 5000, waterline = 3300

  it("keeps below-baseline and below-waterline as distinct conditions", () => {
    const status = computeStatus(snapshot, 6_000);
    expect(status.vsBaseline).toBe("below"); // under personal average…
    expect(status.vsWaterline).toBe("above"); // …but NOT underwater
  });

  it("reports underwater only when position is under the waterline", () => {
    const status = computeStatus({ ...snapshot, liquidAssets: 5_000 }, 6_000);
    expect(status.vsWaterline).toBe("below");
  });

  it("handles a missing baseline", () => {
    expect(computeStatus(snapshot, null).vsBaseline).toBe("at");
  });
});
