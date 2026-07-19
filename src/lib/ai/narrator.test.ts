import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { generateNarration } from "./narrator";
import { NARRATION_SURFACE, narrationInputSchema } from "./schemas";

const input = narrationInputSchema.parse({
  surface: NARRATION_SURFACE,
  companyName: "Test Co",
  periodDays: 30,
  availableCapital: 8000,
  cushion: 1200,
  vsBaseline: "above",
  vsWaterline: "above",
  momentum: { direction: "improving", delta: 2.1, windowDays: 7 },
  drivers: [{ id: "d1", kind: "paycheck", date: "2026-07-15", impact: 4200, buildsEquity: false }],
  score: null,
});

const VALID_BODY =
  "Test Co is trading above its personal baseline with $8,000 of available capital, lifted by a $4,200 paycheck.";

function mockModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("generateNarration", () => {
  it("returns validated output from a well-formed response", async () => {
    const result = await generateNarration(input, {
      model: mockModel(JSON.stringify({ body: VALID_BODY, referencedDriverIds: ["d1"] })),
    });
    expect(result).toEqual({ body: VALID_BODY, referencedDriverIds: ["d1"] });
  });

  it("returns null when the model emits malformed output", async () => {
    const result = await generateNarration(input, {
      model: mockModel("I am not JSON at all"),
    });
    expect(result).toBeNull();
  });

  it("returns null when the narration references an invented driver", async () => {
    const result = await generateNarration(input, {
      model: mockModel(JSON.stringify({ body: VALID_BODY, referencedDriverIds: ["d7"] })),
    });
    expect(result).toBeNull();
  });

  it("returns null when the narration states a dollar figure not present in the input", async () => {
    const hallucinatedBody =
      "Test Co is trading above its personal baseline with $9,000 of available capital, lifted by a $4,200 paycheck.";
    const result = await generateNarration(input, {
      model: mockModel(
        JSON.stringify({ body: hallucinatedBody, referencedDriverIds: ["d1"] }),
      ),
    });
    expect(result).toBeNull();
  });

  it("returns null with no API key and no model override", async () => {
    // Vitest env stubs AI_GATEWAY_API_KEY as absent (env.ts test branch).
    expect(await generateNarration(input)).toBeNull();
  });
});
