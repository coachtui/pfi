import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { generateCsvMappingSuggestion, type CsvMappingAiInput } from "./ai-mapping";

const input: CsvMappingAiInput = {
  accountType: "checking",
  columns: [
    {
      index: 0,
      header: "When",
      nonEmptyRatio: 1,
      dateLikeRatio: 1,
      amountLikeRatio: 0,
      distinctRatio: 1,
      averageLength: 10,
    },
    {
      index: 1,
      header: "Narrative",
      nonEmptyRatio: 1,
      dateLikeRatio: 0,
      amountLikeRatio: 0,
      distinctRatio: 1,
      averageLength: 22,
    },
    {
      index: 2,
      header: "Value",
      nonEmptyRatio: 1,
      dateLikeRatio: 0,
      amountLikeRatio: 1,
      distinctRatio: 1,
      averageLength: 6,
    },
    {
      index: 3,
      header: "Group",
      nonEmptyRatio: 1,
      dateLikeRatio: 0,
      amountLikeRatio: 0,
      distinctRatio: 0.2,
      averageLength: 8,
    },
  ],
  categoryValues: ["Meals"],
};

function mockModel(value: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(value) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("generateCsvMappingSuggestion", () => {
  it("returns validated column and category suggestions", async () => {
    const result = await generateCsvMappingSuggestion(input, {
      model: mockModel({
        columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: 3 },
        signConvention: "positive_inflow",
        categories: [{ source: "Meals", category: "dining" }],
      }),
    });
    expect(result).toEqual({
      columns: { date: 0, description: 1, amount: 2, debit: null, credit: null, category: 3 },
      signConvention: "positive_inflow",
      categoryValues: { meals: "dining" },
    });
  });

  it("drops invented indexes and category labels", async () => {
    const result = await generateCsvMappingSuggestion(input, {
      model: mockModel({
        columns: { date: 12, description: 1, amount: 2, debit: 0, credit: 3, category: 3 },
        signConvention: "positive_inflow",
        categories: [{ source: "Private banking", category: "other" }],
      }),
    });
    expect(result?.columns.date).toBeNull();
    expect(result?.columns.debit).toBeNull();
    expect(result?.categoryValues).toEqual({});
  });

  it("returns null without a configured model", async () => {
    expect(await generateCsvMappingSuggestion(input)).toBeNull();
  });
});
