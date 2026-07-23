import { describe, expect, it } from "vitest";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine";
import { buildBriefInput, buildDriverExplanationsInput, buildDivergenceInput, type NarrationSource } from "./input";

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

describe("buildDriverExplanationsInput", () => {
  const snapshots = buildSnapshots();
  const events = [
    event({
      id: "e1",
      date: snapshots[30].date,
      type: "paycheck",
      amount: 4_200,
      direction: "inflow",
      label: "RAW LABEL — MUST NOT LEAK",
    }),
    event({
      id: "e2",
      date: snapshots[32].date,
      type: "large_purchase",
      amount: 900,
      direction: "outflow",
      label: "ANOTHER RAW LABEL — MUST NOT LEAK",
    }),
  ];
  const source = { companyName: "Test Co", snapshots, events, score: null };

  it("assembles totals and positional driver ids from engine outputs", () => {
    const input = buildDriverExplanationsInput(source);
    expect(input).not.toBeNull();
    expect(input!.surface).toBe("driver_explanations");
    expect(input!.drivers.map((d) => d.id)).toEqual(
      input!.drivers.map((_, i) => `d${i + 1}`),
    );
    const inflow = input!.drivers.filter((d) => d.impact > 0).reduce((s, d) => s + d.impact, 0);
    expect(input!.totalInflow).toBeCloseTo(inflow, 2);
  });

  it("never leaks an event label or real event id across the boundary", () => {
    const input = buildDriverExplanationsInput(source);
    const json = JSON.stringify(input);
    for (const evt of source.events) {
      expect(json).not.toContain(evt.label);
      expect(json).not.toContain(`"${evt.id}"`);
    }
  });

  it("returns null when there are no snapshots", () => {
    expect(buildDriverExplanationsInput({ ...source, snapshots: [] })).toBeNull();
  });

  it("returns null when the window has no drivers", () => {
    expect(buildDriverExplanationsInput({ ...source, events: [] })).toBeNull();
  });

  it("matches buildBriefInput's window: same drivers, same order, same ids", () => {
    const brief = buildBriefInput(source);
    const exp = buildDriverExplanationsInput(source);
    expect(exp!.drivers).toEqual(brief!.drivers);
  });

  it("totalInflow/totalOutflow/netImpact match a hand-computed sum", () => {
    const input = buildDriverExplanationsInput(source);
    expect(input!.totalInflow).toBeCloseTo(4_200, 2);
    expect(input!.totalOutflow).toBeCloseTo(900, 2);
    expect(input!.netImpact).toBeCloseTo(3_300, 2);
  });
});

function snap(date: string, liquid: number): DailySnapshot {
  return {
    date,
    liquidAssets: liquid,
    revolvingBalances: 0,
    nearTermObligations: 0,
    essentialObligations: 0,
    safetyBuffer: 0,
    netWorth: liquid,
  };
}

const base: NarrationSource = {
  companyName: "Koa Holdings",
  snapshots: [snap("2026-07-20", 5000), snap("2026-07-21", 2000)],
  events: [],
  score: { overall: 640, band: "Fair", momentum: "improving" },
};

describe("buildDivergenceInput", () => {
  it("produces an input on a clash", () => {
    expect(buildDivergenceInput(base)).toEqual({
      surface: "score_index_divergence",
      companyName: "Koa Holdings",
      direction: "index_down_score_up",
      scoreMomentum: "improving",
    });
  });

  it("returns null when the score is suppressed (no score object)", () => {
    expect(buildDivergenceInput({ ...base, score: null })).toBeNull();
  });

  it("returns null when there is no clash (score also declining)", () => {
    expect(
      buildDivergenceInput({ ...base, score: { overall: 640, band: "Fair", momentum: "weakening" } }),
    ).toBeNull();
  });
});
