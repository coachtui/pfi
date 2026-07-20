import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { generateNarration } from "./narrator";
import {
  BRIEF_SURFACE,
  briefInputSchema,
  DRIVER_EXPLANATIONS_SURFACE,
  driverExplanationsInputSchema,
  type DriverExplanationsInput,
} from "./schemas";

const input = briefInputSchema.parse({
  surface: BRIEF_SURFACE,
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

/** Same mock-model helper as above, for tests that build the object directly. */
function mockModelReturning(object: unknown) {
  return mockModel(JSON.stringify(object));
}

const driverInput: DriverExplanationsInput = driverExplanationsInputSchema.parse({
  surface: DRIVER_EXPLANATIONS_SURFACE,
  companyName: "Test Co",
  periodDays: 30,
  totalInflow: 3450,
  totalOutflow: 2200,
  netImpact: 1250,
  drivers: [
    { id: "d1", kind: "paycheck", date: "2026-07-03", impact: 3450, buildsEquity: false },
    { id: "d2", kind: "mortgage_payment", date: "2026-07-01", impact: -2200, buildsEquity: false },
  ],
});

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

  it("returns null when the narration mislabels the score as a credit score (observed live: a real model did exactly this)", async () => {
    const mislabeledBody =
      "Test Co's credit score of 695 reflects strong financial health this period.";
    const result = await generateNarration(input, {
      model: mockModel(JSON.stringify({ body: mislabeledBody, referencedDriverIds: [] })),
    });
    expect(result).toBeNull();
  });

  it("returns null with no API key and no model override", async () => {
    // Vitest env stubs AI_GATEWAY_API_KEY as absent (env.ts test branch).
    expect(await generateNarration(input)).toBeNull();
  });
});

describe("generateNarration (driver_explanations)", () => {
  it("returns validated explanations from a well-behaved model", async () => {
    const model = mockModelReturning({
      explanations: [
        { driverId: "d1", body: "A paycheck added $3,450 to available capital." },
        { driverId: "d2", body: "The mortgage payment reduced available capital by $2,200." },
      ],
    });
    const result = await generateNarration(driverInput, { model });
    expect(result?.explanations).toHaveLength(2);
  });

  it("returns null when a driver is missing from the output", async () => {
    const model = mockModelReturning({
      explanations: [{ driverId: "d1", body: "A paycheck added $3,450 to available capital." }],
    });
    expect(await generateNarration(driverInput, { model })).toBeNull();
  });

  it("returns null on a hallucinated dollar figure", async () => {
    const model = mockModelReturning({
      explanations: [
        { driverId: "d1", body: "A paycheck added $7,777 to available capital." },
        { driverId: "d2", body: "The mortgage payment reduced available capital by $2,200." },
      ],
    });
    expect(await generateNarration(driverInput, { model })).toBeNull();
  });

  it("returns null when a body mislabels the score", async () => {
    const model = mockModelReturning({
      explanations: [
        { driverId: "d1", body: "This paycheck is great for your credit score overall." },
        { driverId: "d2", body: "The mortgage payment reduced available capital by $2,200." },
      ],
    });
    expect(await generateNarration(driverInput, { model })).toBeNull();
  });
});
