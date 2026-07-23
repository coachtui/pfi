// src/lib/concepts/content.test.ts
import { describe, expect, it } from "vitest";
import { ALL_CONCEPTS } from "./content";
import { MODULES } from "./modules";
import { validateRegistry } from "./registry";

describe("authored content", () => {
  it("passes registry validation", () => {
    expect(validateRegistry(ALL_CONCEPTS, MODULES)).toEqual([]);
  });

  it("has Module 1 with its five concepts in teaching order", () => {
    const m1 = MODULES.find((m) => m.id === "how-your-household-operates");
    expect(m1?.conceptIds).toEqual(["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"]);
  });

  it("publishes every concept", () => {
    expect(ALL_CONCEPTS.every((c) => c.status === "published")).toBe(true);
  });

  it("gives every Module 1 concept a full lesson", () => {
    for (const id of ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"]) {
      expect(ALL_CONCEPTS.find((c) => c.id === id)?.lesson, id).toBeDefined();
    }
  });

  it("requires householdAdaptation on household-adapted terms", () => {
    // Terms whose PFI formula deviates from the strict corporate definition (audit ruling).
    for (const id of ["revenue", "operating-expenses", "free-cash-flow", "savings-rate"]) {
      const c = ALL_CONCEPTS.find((x) => x.id === id);
      expect(c?.householdAdaptation, id).toBeTruthy();
    }
  });

  it("labels sample figures as sample in every generic example", () => {
    for (const c of ALL_CONCEPTS) {
      if (c.lesson) expect(c.lesson.genericExample.toLowerCase(), c.id).toContain("sample");
    }
  });

  it("has Module 2 with its four concepts in teaching order", () => {
    const m2 = MODULES.find((m) => m.id === "reading-your-household-balance-sheet");
    expect(m2?.conceptIds).toEqual(["assets", "liabilities", "net-worth", "liquidity"]);
  });

  it("gives every Module 2 concept a full lesson", () => {
    for (const id of ["assets", "liabilities", "net-worth", "liquidity"]) {
      expect(ALL_CONCEPTS.find((c) => c.id === id)?.lesson, id).toBeDefined();
    }
  });

  it("has Module 3 anchored by the debt-pressure lesson", () => {
    const m3 = MODULES.find((m) => m.id === "financial-pressure-and-flexibility");
    expect(m3?.conceptIds).toEqual([
      "debt-pressure",
      "short-term-obligations",
      "financial-flexibility",
      "retained-cash",
      "capital-allocation",
    ]);
  });

  it("has Module 4 with its concept in teaching order", () => {
    const m4 = MODULES.find((m) => m.id === "understanding-your-score");
    expect(m4?.conceptIds).toEqual(["score-index-divergence"]);
  });

  it("gives every Module 4 concept a full lesson", () => {
    for (const id of ["score-index-divergence"]) {
      expect(ALL_CONCEPTS.find((c) => c.id === id)?.lesson, id).toBeDefined();
    }
  });

  it("has exactly 16 concepts, 11 with lessons", () => {
    expect(ALL_CONCEPTS).toHaveLength(16);
    expect(ALL_CONCEPTS.filter((c) => c.lesson)).toHaveLength(11);
  });

  it("keeps glossary-only records lesson-free but tappable", () => {
    for (const id of ["short-term-obligations", "financial-flexibility", "retained-cash", "capital-allocation", "available-capital"]) {
      const c = ALL_CONCEPTS.find((x) => x.id === id);
      expect(c?.lesson, id).toBeUndefined();
      expect(c?.shortDefinition, id).toBeTruthy();
      expect(c?.fullDefinition, id).toBeTruthy();
    }
  });

  it("classifies every concept, matching the spec's assignment table", () => {
    const byId = (id: string) => ALL_CONCEPTS.find((c) => c.id === id);
    for (const id of ["available-capital", "score-index-divergence"]) {
      expect(byId(id)?.classification, id).toBe("pfi_metric");
    }
    for (const id of ["savings-rate", "net-worth", "debt-pressure", "financial-flexibility", "retained-cash", "liquidity"]) {
      expect(byId(id)?.classification, id).toBe("household_adaptation");
    }
    for (const id of ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "assets", "liabilities", "short-term-obligations", "capital-allocation"]) {
      expect(byId(id)?.classification, id).toBe("standard_finance");
    }
  });

  it("keeps internal engineering language out of user-facing content", () => {
    const banned = [/audit ruling/i, /spec finding/i, /\btask \d/i, /decisions #/i, /implementation plan/i];
    for (const c of ALL_CONCEPTS) {
      const serialized = JSON.stringify(c);
      for (const pattern of banned) {
        expect(serialized, `${c.id} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  describe("Slice C — glossary definition-sheet migration", () => {
    it.each([
      { id: "retained-cash", formula: true },
      { id: "financial-flexibility", formula: true },
    ])("$id carries the definition-sheet fields", ({ id, formula }) => {
      const c = ALL_CONCEPTS.find((x) => x.id === id);
      expect(c?.plainEnglishSummary, id).toBeTruthy();
      expect(c?.whereUsed?.length ?? 0, id).toBeGreaterThan(0);
      if (formula) {
        expect(c?.formulaRows?.length ?? 0, id).toBeGreaterThan(0);
        expect(c?.formula, id).toBeTruthy();
      }
    });
  });
});
