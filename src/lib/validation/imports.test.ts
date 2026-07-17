import { describe, expect, it } from "vitest";
import { importTransactionsSchema } from "./imports";

const validRow = {
  line: 2,
  postedDate: "2026-07-01",
  amount: 4.5,
  direction: "outflow" as const,
  description: "COFFEE",
  category: "other" as const,
};
const valid = {
  accountId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  rows: [validRow],
  transferPairs: [],
};

describe("importTransactionsSchema", () => {
  it("accepts a valid payload", () => {
    expect(importTransactionsSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects empty rows, >10000 rows, and bad uuids", () => {
    expect(importTransactionsSchema.safeParse({ ...valid, rows: [] }).success).toBe(false);
    expect(
      importTransactionsSchema.safeParse({
        ...valid,
        rows: Array.from({ length: 10_001 }, (_, i) => ({ ...validRow, line: i + 2 })),
      }).success,
    ).toBe(false);
    expect(importTransactionsSchema.safeParse({ ...valid, accountId: "nope" }).success).toBe(false);
  });
  it("rejects bad rows: future date, negative amount, >2 decimals, unknown category, long description", () => {
    const bad = (over: object) =>
      importTransactionsSchema.safeParse({ ...valid, rows: [{ ...validRow, ...over }] }).success;
    expect(bad({ postedDate: "2999-01-01" })).toBe(false);
    expect(bad({ amount: -1 })).toBe(false);
    expect(bad({ amount: 1.999 })).toBe(false);
    expect(bad({ category: "snacks" })).toBe(false);
    expect(bad({ description: "x".repeat(201) })).toBe(false);
  });
  it("rejects malformed transfer pairs", () => {
    expect(
      importTransactionsSchema.safeParse({
        ...valid,
        transferPairs: [{ line: 2, existingId: "not-a-uuid" }],
      }).success,
    ).toBe(false);
  });
});
