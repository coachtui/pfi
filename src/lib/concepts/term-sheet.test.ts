import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import { buildRegistry } from "./registry";
import { buildTermSheetModel } from "./term-sheet";
import type { FinancialConcept } from "./types";

const glossary: FinancialConcept = {
  id: "alpha", title: "Alpha", classification: "standard_finance",
  shortDefinition: "Short.", fullDefinition: "Full.", whyItMatters: "Matters.",
  relatedConceptIds: [], prerequisiteConceptIds: [], status: "published",
};
const withLesson: FinancialConcept = {
  ...glossary, id: "beta", title: "Beta",
  plainEnglishSummary: "One strong sentence.",
  whereUsed: ["Report"],
  lesson: {
    opening: "O.", standardTerm: "S.", genericExample: "Sample x.", commonMisunderstanding: "M.",
    knowledgeChecks: [{ id: "beta-check-1", kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "E." }],
  },
};
const draft: FinancialConcept = { ...glossary, id: "gamma", status: "draft" };
const REG = buildRegistry([glossary, withLesson, draft], []);

describe("buildTermSheetModel", () => {
  it("returns null for unknown or unpublished concepts", () => {
    expect(buildTermSheetModel(REG, "nope")).toBeNull();
    expect(buildTermSheetModel(REG, "gamma")).toBeNull();
  });

  it("un-gates whyItMatters and classification at every state", () => {
    const m = buildTermSheetModel(REG, "alpha");
    expect(m?.whyItMatters).toBe("Matters.");
    expect(m?.classification).toBe("standard_finance");
  });

  it("falls back to shortDefinition + fullDefinition when plainEnglishSummary is absent", () => {
    const m = buildTermSheetModel(REG, "alpha");
    expect(m?.summary).toBe("Short.");
    expect(m?.detail).toBe("Full.");
  });

  it("uses plainEnglishSummary alone when present", () => {
    const m = buildTermSheetModel(REG, "beta");
    expect(m?.summary).toBe("One strong sentence.");
    expect(m?.detail).toBeUndefined();
    expect(m?.whereUsed).toEqual(["Report"]);
  });

  it("passes lesson progress through and forces glossary-only to not-started", () => {
    expect(buildTermSheetModel(REG, "beta", { progress: "in-progress" })?.progress).toBe("in-progress");
    expect(buildTermSheetModel(REG, "beta", { progress: "completed" })?.progress).toBe("completed");
    expect(buildTermSheetModel(REG, "beta")?.progress).toBe("not-started");
    expect(buildTermSheetModel(REG, "alpha", { progress: "completed" })?.progress).toBe("not-started");
  });

  it("builds against the real registry without error for every published concept", () => {
    for (const c of CONCEPT_REGISTRY.published()) {
      expect(buildTermSheetModel(CONCEPT_REGISTRY, c.id), c.id).not.toBeNull();
    }
  });
});
