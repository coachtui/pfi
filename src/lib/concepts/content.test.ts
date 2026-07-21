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
});
