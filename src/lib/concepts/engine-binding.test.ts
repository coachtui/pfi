// src/lib/concepts/engine-binding.test.ts
import { describe, expect, it } from "vitest";
import { METRICS } from "../financial-engine/metrics";
import { ALL_CONCEPTS } from "./content";

/** PeriodStatement numeric fields (src/lib/financial-engine/report.ts). */
const REPORT_FIELDS = new Set([
  "revenue", "operatingExpenses", "freeCashFlow", "savings", "investments",
  "debtReduction", "ownerCreatedEquity", "indexChange", "indexEnd", "savingsRatePct",
]);
/** DailySnapshot numeric fields (src/lib/financial-engine/types.ts). */
const SNAPSHOT_FIELDS = new Set([
  "liquidAssets", "revolvingBalances", "nearTermObligations", "essentialObligations", "safetyBuffer", "netWorth",
]);
/** Exported functions of src/lib/financial-engine/position.ts. */
const POSITION_FNS = new Set(["availablePosition", "waterline", "cushion"]);

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
