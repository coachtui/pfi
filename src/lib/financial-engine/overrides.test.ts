import { describe, expect, it } from "vitest";
import { applyOverride, parseOverride, type CorrectableTransaction } from "./overrides";

const base: CorrectableTransaction = {
  id: "t1", accountId: "a1", postedDate: "2026-06-01", amount: 120,
  direction: "outflow", description: "Card purchases", category: "discretionary",
  essential: false, isTransfer: false, transferPairId: null, userOverride: null,
};

describe("parseOverride", () => {
  it("returns null for null, arrays, and non-objects", () => {
    expect(parseOverride(null)).toBeNull();
    expect(parseOverride([])).toBeNull();
    expect(parseOverride("x")).toBeNull();
    expect(parseOverride(42)).toBeNull();
  });

  it("keeps only string category/description keys", () => {
    expect(parseOverride({ category: "groceries", description: "Farmers market" }))
      .toEqual({ category: "groceries", description: "Farmers market" });
    expect(parseOverride({ category: 7, description: null })).toBeNull();
  });

  it("ignores hostile keys that would change balances", () => {
    const parsed = parseOverride({ amount: 9999, postedDate: "2020-01-01", direction: "inflow", category: "groceries" });
    expect(parsed).toEqual({ category: "groceries" });
  });

  it("returns null for an empty object", () => {
    expect(parseOverride({})).toBeNull();
  });
});

describe("applyOverride", () => {
  it("passes through untouched when there is no override", () => {
    const eff = applyOverride(base);
    expect(eff.category).toBe("discretionary");
    expect(eff.description).toBe("Card purchases");
    expect(eff.corrected).toBe(false);
    expect(eff.original).toBeNull();
  });

  it("applies a category override and preserves the original", () => {
    const eff = applyOverride({ ...base, userOverride: { category: "groceries" } });
    expect(eff.category).toBe("groceries");
    expect(eff.description).toBe("Card purchases");
    expect(eff.corrected).toBe(true);
    expect(eff.original).toEqual({ category: "discretionary", description: "Card purchases" });
  });

  it("applies a description override", () => {
    const eff = applyOverride({ ...base, userOverride: { description: "Costco run" } });
    expect(eff.description).toBe("Costco run");
    expect(eff.category).toBe("discretionary");
    expect(eff.corrected).toBe(true);
  });

  it("never changes amount, date, direction, or transfer fields", () => {
    const eff = applyOverride({ ...base, userOverride: { category: "income", description: "x" } });
    expect(eff.amount).toBe(base.amount);
    expect(eff.postedDate).toBe(base.postedDate);
    expect(eff.direction).toBe(base.direction);
    expect(eff.isTransfer).toBe(base.isTransfer);
    expect(eff.transferPairId).toBe(base.transferPairId);
  });
});
