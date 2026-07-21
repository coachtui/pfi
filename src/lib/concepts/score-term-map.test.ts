import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import { METRICS } from "@/lib/financial-engine/metrics";
import { SCORE_METRIC_CONCEPT_IDS } from "./score-term-map";

describe("SCORE_METRIC_CONCEPT_IDS", () => {
  const metricIds = new Set(METRICS.map((d) => d.id));

  it("every key is a real score metric id", () => {
    for (const key of Object.keys(SCORE_METRIC_CONCEPT_IDS)) {
      expect(metricIds.has(key), `unknown metric id: ${key}`).toBe(true);
    }
  });

  it("every value is a published concept", () => {
    for (const id of Object.values(SCORE_METRIC_CONCEPT_IDS)) {
      expect(CONCEPT_REGISTRY.byId(id)?.status, `not published: ${id}`).toBe("published");
    }
  });
});
