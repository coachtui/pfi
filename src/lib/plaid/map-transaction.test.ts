import { describe, expect, it } from "vitest";
import { PROVIDER_COLUMNS, mapCategoryConfidence, substantiveChange, toProviderColumns } from "./map-transaction";
import type { PlaidTransactionShape } from "./types";

const base: PlaidTransactionShape = {
  transactionId: "txn-1",
  accountId: "acct-1",
  amount: 12.34,
  date: "2026-09-01",
  authorizedDate: "2026-08-31",
  name: "SQ *BLUE BOTTLE",
  merchantName: "Blue Bottle Coffee",
  pending: false,
  personalFinanceCategory: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE", confidenceLevel: "VERY_HIGH" },
  taxonomyVersion: "v2",
};

describe("toProviderColumns", () => {
  it("maps a depository debit as an outflow with merchant name, category, raw taxonomy and confidence", () => {
    expect(toProviderColumns(base)).toEqual({
      posted_date: "2026-09-01",
      authorized_date: "2026-08-31",
      amount: 12.34,
      direction: "outflow",
      description: "Blue Bottle Coffee",
      category: "dining",
      category_confidence: "very_high",
      pfc_primary: "FOOD_AND_DRINK",
      pfc_detailed: "FOOD_AND_DRINK_COFFEE",
      category_taxonomy_version: "v2",
    });
  });

  it("maps a negative amount (money arriving) as an inflow with a positive stored amount", () => {
    const cols = toProviderColumns({ ...base, amount: -2500, personalFinanceCategory: { primary: "INCOME", detailed: "INCOME_WAGES", confidenceLevel: "HIGH" } });
    expect(cols.direction).toBe("inflow");
    expect(cols.amount).toBe(2500);
    expect(cols.category).toBe("income");
  });

  it("treats a credit-card charge the same way: positive → outflow (liability inversion lives in the engine)", () => {
    const charge = toProviderColumns({ ...base, accountId: "card", amount: 80 });
    const payment = toProviderColumns({ ...base, accountId: "card", amount: -80, personalFinanceCategory: { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", confidenceLevel: null } });
    expect(charge.direction).toBe("outflow");
    expect(payment.direction).toBe("inflow");
    expect(payment.category_confidence).toBe("unknown");
  });

  it("falls back from merchant name to name to a generic label, and rounds to cents", () => {
    expect(toProviderColumns({ ...base, merchantName: null }).description).toBe("SQ *BLUE BOTTLE");
    expect(toProviderColumns({ ...base, merchantName: " ", name: "" }).description).toBe("Transaction");
    expect(toProviderColumns({ ...base, amount: 0.005 }).amount).toBe(0.01);
  });

  it("handles a missing personal_finance_category", () => {
    const cols = toProviderColumns({ ...base, personalFinanceCategory: null });
    expect(cols.category).toBe("other");
    expect(cols.pfc_primary).toBeNull();
    expect(cols.category_confidence).toBe("unknown");
  });

  it("refuses pending transactions (posted-only policy)", () => {
    expect(() => toProviderColumns({ ...base, pending: true })).toThrow(/pending/);
  });

  it("produces exactly the provider-owned column set from spec §6 and nothing user-owned", () => {
    const keys = Object.keys(toProviderColumns(base)).sort();
    expect(keys).toEqual([...PROVIDER_COLUMNS].sort());
    for (const userOwned of ["user_override", "notes", "essential", "confidence", "is_transfer", "transfer_pair_id", "recurring_status"]) {
      expect(keys).not.toContain(userOwned);
    }
  });
});

describe("mapCategoryConfidence", () => {
  it.each([
    ["VERY_HIGH", "very_high"], ["HIGH", "high"], ["MEDIUM", "medium"], ["LOW", "low"], ["UNKNOWN", "unknown"], [null, "unknown"], ["weird", "unknown"],
  ] as const)("%s → %s", (input, expected) => {
    expect(mapCategoryConfidence(input)).toBe(expected);
  });
});

describe("substantiveChange", () => {
  const a = toProviderColumns(base);
  it("is true only for date, amount, or direction changes", () => {
    expect(substantiveChange(a, { ...a })).toBe(false);
    expect(substantiveChange(a, { ...a, description: "renamed", category: "shopping" })).toBe(false);
    expect(substantiveChange(a, { ...a, amount: 13 })).toBe(true);
    expect(substantiveChange(a, { ...a, posted_date: "2026-09-02" })).toBe(true);
    expect(substantiveChange(a, { ...a, direction: "inflow" })).toBe(true);
  });
});
