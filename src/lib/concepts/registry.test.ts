import { describe, expect, it } from "vitest";
import { buildRegistry, validateRegistry } from "./registry";
import type { FinancialConcept, Module } from "./types";

const concept = (id: string, over: Partial<FinancialConcept> = {}): FinancialConcept => ({
  id,
  title: id,
  shortDefinition: "One sentence.",
  fullDefinition: "Full definition.",
  whyItMatters: "Why it matters.",
  relatedConceptIds: [],
  prerequisiteConceptIds: [],
  status: "published",
  ...over,
});

const lesson = (over: Partial<NonNullable<FinancialConcept["lesson"]>> = {}) => ({
  intro: "Intro.",
  standardTerm: "Term.",
  genericExample: "Example.",
  commonMisunderstanding: "Misunderstanding.",
  knowledgeCheck: [
    { kind: "interpretation" as const, prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "Because." },
  ],
  reinforcementPreview: "Preview.",
  ...over,
});

const mod = (id: string, conceptIds: string[], order = 1): Module => ({ id, title: id, order, conceptIds });

describe("buildRegistry", () => {
  it("looks up concepts by id and filters published", () => {
    const draft = concept("b", { status: "draft" });
    const reg = buildRegistry([concept("a"), draft], [mod("m1", ["a"])]);
    expect(reg.byId("a")?.title).toBe("a");
    expect(reg.byId("missing")).toBeUndefined();
    expect(reg.published().map((c) => c.id)).toEqual(["a"]);
    expect(reg.forModule("m1").map((c) => c.id)).toEqual(["a"]);
  });
});

describe("validateRegistry", () => {
  it("accepts a valid registry", () => {
    const a = concept("a");
    const b = concept("b", { prerequisiteConceptIds: ["a"], relatedConceptIds: ["a"], lesson: lesson() });
    expect(validateRegistry([a, b], [mod("m1", ["a", "b"])])).toEqual([]);
  });

  it("rejects duplicate ids", () => {
    expect(validateRegistry([concept("a"), concept("a")], [])).toContainEqual(expect.stringContaining("duplicate"));
  });

  it("rejects non-kebab-case ids", () => {
    expect(validateRegistry([concept("Free Cash Flow")], [])).toContainEqual(expect.stringContaining("kebab-case"));
  });

  it("rejects unknown related/prerequisite ids", () => {
    const errs = validateRegistry([concept("a", { relatedConceptIds: ["ghost"], prerequisiteConceptIds: ["ghost2"] })], []);
    expect(errs).toContainEqual(expect.stringContaining("ghost"));
    expect(errs).toContainEqual(expect.stringContaining("ghost2"));
  });

  it("rejects prerequisite cycles", () => {
    const a = concept("a", { prerequisiteConceptIds: ["b"] });
    const b = concept("b", { prerequisiteConceptIds: ["a"] });
    expect(validateRegistry([a, b], [])).toContainEqual(expect.stringContaining("cycle"));
  });

  it("rejects modules referencing unknown concepts", () => {
    expect(validateRegistry([concept("a")], [mod("m1", ["a", "ghost"])])).toContainEqual(
      expect.stringContaining("ghost"),
    );
  });

  it("rejects lessons with zero or more than two knowledge checks", () => {
    const zero = concept("a", { lesson: lesson({ knowledgeCheck: [] }) });
    const three = concept("b", {
      lesson: lesson({
        knowledgeCheck: [
          { kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "x" },
          { kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "x" },
          { kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "x" },
        ],
      }),
    });
    const errs = validateRegistry([zero, three], []);
    expect(errs.filter((e) => e.includes("knowledge check"))).toHaveLength(2);
  });

  it("rejects out-of-bounds correctIndex", () => {
    const bad = concept("a", {
      lesson: lesson({
        knowledgeCheck: [{ kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 2, explanation: "x" }],
      }),
    });
    expect(validateRegistry([bad], [])).toContainEqual(expect.stringContaining("correctIndex"));
  });
});
