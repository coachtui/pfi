import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPTS, BRIEF_SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import { BRIEF_SURFACE, briefInputSchema } from "./schemas";

const input = briefInputSchema.parse({
  surface: BRIEF_SURFACE,
  companyName: "Test Co",
  periodDays: 30,
  availableCapital: 8000,
  cushion: 1200,
  vsBaseline: "below",
  vsWaterline: "above",
  momentum: { direction: "declining", delta: -1.8, windowDays: 7 },
  drivers: [{ id: "d1", kind: "large_purchase", date: "2026-07-12", impact: -2400, buildsEquity: false }],
  score: null,
});

describe("policy prompt", () => {
  it("encodes the binding policy rules", () => {
    for (const phrase of [
      "only the metrics provided",
      "never invent",
      "not financial, tax, legal, or investment advice",
      "no shame",
      "referencedDriverIds",
      "not a credit score",
    ]) {
      expect(BRIEF_SYSTEM_PROMPT.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("embeds the input metrics verbatim and nothing else", () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('"availableCapital": 8000');
    expect(prompt).toContain('"kind": "large_purchase"');
    expect(prompt).toMatchSnapshot();
  });
});

describe("driver_explanations prompt", () => {
  it("brief entry is the unchanged brief prompt", () => {
    expect(SYSTEM_PROMPTS.performance_brief).toBe(BRIEF_SYSTEM_PROMPT);
  });
  it("snapshot makes wording changes deliberate", () => {
    expect(SYSTEM_PROMPTS.driver_explanations).toMatchSnapshot();
  });
  it("user prompt embeds the input JSON and period", () => {
    const prompt = buildUserPrompt({
      surface: "driver_explanations",
      companyName: "Test Co",
      periodDays: 30,
      totalInflow: 100,
      totalOutflow: 0,
      netImpact: 100,
      drivers: [{ id: "d1", kind: "paycheck", date: "2026-07-03", impact: 100, buildsEquity: false }],
    });
    expect(prompt).toContain("last 30 days");
    expect(prompt).toContain('"d1"');
  });
});
