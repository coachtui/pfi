import { describe, expect, it } from "vitest";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine";
import { buildBriefInput } from "./input";

/**
 * Fixture helpers mirror the convention established in
 * src/lib/financial-engine/position.test.ts and insights.test.ts.
 */
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

const event = (overrides: Partial<FinancialEvent> = {}): FinancialEvent => ({
  id: "e1",
  date: "2026-07-10",
  type: "paycheck",
  label: "RAW LABEL — MUST NOT LEAK",
  amount: 3_200,
  direction: "inflow",
  ...overrides,
});

/** 40 consecutive daily snapshots ending 2026-07-20, liquid assets drifting up. */
function buildSnapshots(): DailySnapshot[] {
  const start = new Date("2026-06-11T00:00:00Z");
  return Array.from({ length: 40 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    return snapshot({ date, liquidAssets: 10_000 + i * 25 });
  });
}

describe("buildBriefInput", () => {
  it("returns null with no snapshots", () => {
    expect(
      buildBriefInput({ companyName: "T", snapshots: [], events: [], score: null }),
    ).toBeNull();
  });

  it("assembles a schema-valid input from engine outputs", () => {
    const snapshots = buildSnapshots();
    const events = [
      event({ id: "e1", date: snapshots[35].date, type: "paycheck", amount: 4_200, direction: "inflow" }),
    ];
    const input = buildBriefInput({
      companyName: "Test Co",
      snapshots,
      events,
      score: { overall: 600, band: "Solid", momentum: "improving" },
    });

    expect(input).not.toBeNull();
    expect(input!.companyName).toBe("Test Co");
    expect(input!.drivers[0]).toMatchObject({
      id: "d1",
      kind: "paycheck",
      impact: 4_200,
      buildsEquity: false,
    });
    expect(input!.periodDays).toBeLessThanOrEqual(30);
  });

  it("never includes event labels or ids (raw-data boundary)", () => {
    const snapshots = buildSnapshots();
    const events = [
      event({
        id: "e1",
        date: snapshots[35].date,
        type: "large_purchase",
        amount: 900,
        direction: "outflow",
        label: "RAW LABEL — MUST NOT LEAK",
      }),
    ];
    const input = buildBriefInput({ companyName: "T", snapshots, events, score: null });
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("RAW LABEL");
    expect(serialized).not.toContain('"e1"');
  });

  it("marks vsBaseline unknown before the baseline can be established", () => {
    // rollingBaseline's minPeriods is 7 (src/lib/financial-engine/indexing.ts);
    // 5 days of history means baseline stays null for every point, including
    // the latest — vsBaseline must surface that as "unknown", not "below".
    const start = new Date("2026-07-01T00:00:00Z");
    const snapshots = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      return snapshot({ date, liquidAssets: 10_000 + i * 25 });
    });
    const input = buildBriefInput({ companyName: "T", snapshots, events: [], score: null });
    expect(input!.vsBaseline).toBe("unknown");
  });

  it("marks equity-building drivers", () => {
    const snapshots = buildSnapshots();
    const events = [
      event({
        id: "e1",
        date: snapshots[35].date,
        type: "investment_contribution",
        amount: 500,
        direction: "outflow",
      }),
    ];
    const input = buildBriefInput({ companyName: "T", snapshots, events, score: null });
    expect(input!.drivers[0]).toMatchObject({ impact: -500, buildsEquity: true });
  });
});
