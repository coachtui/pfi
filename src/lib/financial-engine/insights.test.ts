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

import { driverExplanationText, EVENT_TYPE_LABELS } from "./insights";
import type { Driver, FinancialEventType } from "./types";

describe("driverExplanationText", () => {
  const paycheck: Driver = {
    event: { id: "e1", date: "2026-07-03", type: "paycheck", label: "Acme payroll", amount: 3450, direction: "inflow" },
    impact: 3450,
  };
  const mortgage: Driver = {
    event: { id: "e2", date: "2026-07-01", type: "mortgage_payment", label: "Home loan", amount: 2200, direction: "outflow" },
    impact: -2200,
  };
  const investment: Driver = {
    event: { id: "e3", date: "2026-07-10", type: "investment_contribution", label: "401k", amount: 500, direction: "outflow" },
    impact: -500,
  };
  const total = 3450 + 2200 + 500;

  it("describes an inflow with amount, date, and share of movement", () => {
    const text = driverExplanationText(paycheck, { totalMovement: total });
    expect(text).toContain("Paycheck");
    expect(text).toContain("$3,450");
    expect(text).toContain("Jul 3");
    expect(text).toContain("56%");
    expect(text).not.toContain("Acme payroll"); // type-derived, parity with the AI path
  });

  it("describes an outflow as reducing available capital", () => {
    const text = driverExplanationText(mortgage, { totalMovement: total });
    expect(text).toContain("reduced available capital");
    expect(text).toContain("$2,200");
  });

  it("frames equity-building outflows constructively, never as losses", () => {
    const text = driverExplanationText(investment, { totalMovement: total });
    expect(text).toContain("equity");
    expect(text).not.toMatch(/loss(?!\w)/i);
  });

  it("omits the share clause when totalMovement is zero", () => {
    const text = driverExplanationText(paycheck, { totalMovement: 0 });
    expect(text).not.toContain("%");
  });

  it("has a label for every event type", () => {
    const types: FinancialEventType[] = [
      "paycheck", "bonus", "mortgage_payment", "large_purchase", "insurance_payment",
      "investment_contribution", "debt_payment", "debt_payoff", "tax_payment", "unexpected_expense",
    ];
    for (const t of types) expect(EVENT_TYPE_LABELS[t]).toBeTruthy();
  });
});
