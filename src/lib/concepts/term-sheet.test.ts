import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import { buildTermSheetModel } from "./term-sheet";

describe("buildTermSheetModel", () => {
  it("returns the view-model for a published concept", () => {
    const m = buildTermSheetModel(CONCEPT_REGISTRY, "free-cash-flow");
    expect(m).not.toBeNull();
    expect(m!.title).toBe("Free cash flow");
    expect(m!.shortDefinition.length).toBeGreaterThan(0);
    expect(m!.fullDefinition.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown concept id", () => {
    expect(buildTermSheetModel(CONCEPT_REGISTRY, "owner-created-equity")).toBeNull();
    expect(buildTermSheetModel(CONCEPT_REGISTRY, "does-not-exist")).toBeNull();
  });

  it("filters related concepts to published records only", () => {
    const m = buildTermSheetModel(CONCEPT_REGISTRY, "free-cash-flow");
    expect(m).not.toBeNull();
    for (const r of m!.related) {
      const c = CONCEPT_REGISTRY.byId(r.id);
      expect(c?.status).toBe("published");
      expect(r.title).toBe(c!.title);
    }
  });

  it("omits the formula when the concept has none", () => {
    const m = buildTermSheetModel(CONCEPT_REGISTRY, "financial-flexibility");
    expect(m).not.toBeNull();
    expect(m!.formula).toBeUndefined();
  });
});
