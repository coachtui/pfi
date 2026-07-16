import { describe, expect, it } from "vitest";
import {
  accountSchema, createTransactionSchema, overrideTransactionSchema,
  parseTransactionFilters,
} from "./transactions";

const goodTxn = {
  accountId: "3f0e0e46-9c5b-4b0e-8f6e-0a4a25dd8f11",
  postedDate: "2026-07-01", amount: 42.5, direction: "outflow" as const,
  description: "Groceries", category: "groceries" as const,
};

describe("createTransactionSchema", () => {
  it("accepts a valid manual transaction", () => {
    expect(createTransactionSchema.safeParse(goodTxn).success).toBe(true);
  });
  it("rejects zero/negative amounts", () => {
    expect(createTransactionSchema.safeParse({ ...goodTxn, amount: 0 }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...goodTxn, amount: -5 }).success).toBe(false);
  });
  it("rejects future dates", () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect(createTransactionSchema.safeParse({ ...goodTxn, postedDate: future }).success).toBe(false);
  });
  it("rejects an empty description and unknown categories", () => {
    expect(createTransactionSchema.safeParse({ ...goodTxn, description: "  " }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...goodTxn, category: "yachts" }).success).toBe(false);
  });
});

describe("overrideTransactionSchema", () => {
  const id = goodTxn.accountId;
  it("requires at least one change", () => {
    expect(overrideTransactionSchema.safeParse({ id }).success).toBe(false);
  });
  it("accepts nulls as clear-this-field", () => {
    expect(overrideTransactionSchema.safeParse({ id, category: null }).success).toBe(true);
    expect(overrideTransactionSchema.safeParse({ id, notes: null }).success).toBe(true);
  });
});

describe("accountSchema", () => {
  const good = { displayName: "House Checking", type: "checking" as const, currentBalance: 1200 };
  it("accepts a minimal manual account", () => {
    expect(accountSchema.safeParse(good).success).toBe(true);
  });
  it("rejects unknown types and negative balances", () => {
    expect(accountSchema.safeParse({ ...good, type: "crypto" }).success).toBe(false);
    expect(accountSchema.safeParse({ ...good, currentBalance: -10 }).success).toBe(false);
  });
});

describe("parseTransactionFilters", () => {
  it("keeps valid params and drops junk", () => {
    expect(parseTransactionFilters({
      account: "abc", category: "groceries", direction: "inflow",
      from: "2026-07-01", to: "2026-07-15",
    })).toEqual({ account: "abc", category: "groceries", direction: "inflow", from: "2026-07-01", to: "2026-07-15" });
    expect(parseTransactionFilters({ category: "yachts", direction: "sideways", from: "nope", to: ["a"] }))
      .toEqual({ account: undefined, category: undefined, direction: undefined, from: undefined, to: undefined });
  });
});
