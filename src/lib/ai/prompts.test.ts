import { describe, expect, it } from "vitest";
import { BRIEF_SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
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
