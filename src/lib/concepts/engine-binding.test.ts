// src/lib/concepts/engine-binding.test.ts
import { describe, expect, it } from "vitest";
import { METRICS } from "../financial-engine/metrics";
import { computePeriodStatement, type PeriodStatement, type ReportPeriod } from "../financial-engine/report";
import type { DailySnapshot } from "../financial-engine/types";
import * as position from "../financial-engine/position";
import { ALL_CONCEPTS } from "./content";

// Every namespace below is derived from the real engine at test time (rather
// than hand-copied) so a field/function rename in the engine breaks this test
// instead of silently leaving a dangling concept binding.

/**
 * `report:` fields — built from a real PeriodStatement returned by
 * computePeriodStatement() against a minimal but valid fixture, then reduced
 * to its numeric fields (this drops the nested, non-numeric `period` field
 * automatically; no manual exclusion needed).
 */
const fixturePeriod: ReportPeriod = {
  key: "2026-M01",
  label: "January 2026",
  start: "2026-01-01",
  end: "2026-01-31",
  complete: true,
};
const fixtureSnapshots: DailySnapshot[] = [
  {
    date: "2025-12-31",
    liquidAssets: 1000,
    revolvingBalances: 200,
    nearTermObligations: 500,
    essentialObligations: 400,
    safetyBuffer: 100,
    netWorth: 5000,
  },
  {
    date: "2026-01-31",
    liquidAssets: 1200,
    revolvingBalances: 150,
    nearTermObligations: 500,
    essentialObligations: 400,
    safetyBuffer: 100,
    netWorth: 5300,
  },
];
const fixtureStatement: PeriodStatement = computePeriodStatement(
  fixtureSnapshots,
  [],
  [],
  [],
  fixturePeriod,
);
const REPORT_FIELDS = new Set(
  Object.keys(fixtureStatement).filter(
    (k) => typeof fixtureStatement[k as keyof PeriodStatement] === "number",
  ),
);

/**
 * `snapshot:` fields — a literal typed as `DailySnapshot` so TypeScript
 * compilation itself breaks if a field is renamed, reduced to numeric fields
 * (drops the `date` string field automatically).
 */
const fixtureSnapshot: DailySnapshot = {
  date: "2026-01-01",
  liquidAssets: 0,
  revolvingBalances: 0,
  nearTermObligations: 0,
  essentialObligations: 0,
  safetyBuffer: 0,
  netWorth: 0,
};
const SNAPSHOT_FIELDS = new Set(
  Object.keys(fixtureSnapshot).filter(
    (k) => typeof fixtureSnapshot[k as keyof DailySnapshot] === "number",
  ),
);

/** `position:` functions — every exported function of position.ts. */
const POSITION_FNS = new Set(
  Object.keys(position).filter((k) => typeof position[k as keyof typeof position] === "function"),
);

const resolves = (key: string): boolean => {
  const [ns, rest] = key.split(":");
  if (ns === "metric") return METRICS.some((m) => m.id === rest);
  if (ns === "report") return REPORT_FIELDS.has(rest);
  if (ns === "snapshot") return SNAPSHOT_FIELDS.has(rest);
  if (ns === "position") return POSITION_FNS.has(rest);
  return false;
};

describe("concept → engine bindings", () => {
  it("resolves every dataMetricKey and personalApplication.metricKey", () => {
    for (const c of ALL_CONCEPTS) {
      if (c.dataMetricKey) expect(resolves(c.dataMetricKey), `${c.id}: ${c.dataMetricKey}`).toBe(true);
      const pk = c.lesson?.personalApplication?.metricKey;
      if (pk) expect(resolves(pk), `${c.id}: ${pk}`).toBe(true);
    }
  });
});
