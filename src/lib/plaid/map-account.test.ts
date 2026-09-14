import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES } from "@/lib/validation/transactions";
import { mapAccount, mapAccountType } from "./map-account";
import type { PlaidAccountShape } from "./types";

describe("mapAccountType", () => {
  it.each([
    ["depository", "checking", "checking"],
    ["depository", "cash management", "checking"],
    ["depository", "paypal", "checking"],
    ["depository", "savings", "savings"],
    ["depository", "cd", "savings"],
    ["depository", "hsa", "savings"],
    ["depository", "money market", "money_market"],
    ["credit", "credit card", "credit_card"],
    ["credit", "paypal", "credit_card"],
    ["loan", "mortgage", "mortgage"],
    ["loan", "home equity", "mortgage"],
    ["loan", "auto", "auto_loan"],
    ["loan", "student", "student_loan"],
    ["loan", "personal", "personal_loan"],
    ["loan", "business", "personal_loan"],
    ["investment", "401k", "retirement"],
    ["investment", "403b", "retirement"],
    ["investment", "457b", "retirement"],
    ["investment", "ira", "retirement"],
    ["investment", "roth", "retirement"],
    ["investment", "roth 401k", "retirement"],
    ["investment", "sep ira", "retirement"],
    ["investment", "simple ira", "retirement"],
    ["investment", "pension", "retirement"],
    ["investment", "tsp", "retirement"],
    ["investment", "hsa", "retirement"],
    ["investment", "brokerage", "brokerage"],
    ["investment", "529", "brokerage"],
    ["investment", "crypto exchange", "brokerage"],
    ["investment", "mutual fund", "brokerage"],
    ["investment", "ugma", "brokerage"],
    ["other", "other", "other_asset"],
    ["other", null, "other_asset"],
  ] as const)("%s/%s → %s", (type, subtype, expected) => {
    expect(mapAccountType(type, subtype)).toBe(expected);
  });

  it("falls back conservatively on unknown subtypes and types", () => {
    expect(mapAccountType("depository", "something new")).toBe("checking");
    expect(mapAccountType("loan", "something new")).toBe("personal_loan");
    expect(mapAccountType("investment", "something new")).toBe("brokerage");
    expect(mapAccountType("future-type", null)).toBe("other_asset");
  });

  it("is case-insensitive", () => {
    expect(mapAccountType("Depository", "Money Market")).toBe("money_market");
  });

  it("only ever returns a registered PFI account type", () => {
    const types = ["depository", "credit", "loan", "investment", "other", "x"];
    const subtypes = ["checking", "401k", "auto", null, "zzz"];
    for (const t of types) for (const s of subtypes) {
      expect(ACCOUNT_TYPES).toContain(mapAccountType(t, s));
    }
  });
});

describe("mapAccount", () => {
  const base: PlaidAccountShape = {
    accountId: "acct-1",
    name: "Plaid Checking",
    officialName: "Plaid Gold Standard 0% Interest Checking",
    mask: "0000",
    type: "depository",
    subtype: "checking",
    balances: { current: 110, available: 100, limit: null, lastUpdatedDatetime: null },
  };

  it("prefers the official name, keeps only the mask, carries the credit limit", () => {
    const m = mapAccount({ ...base, type: "credit", subtype: "credit card", balances: { ...base.balances, limit: 2000 } }, "First Platypus Bank");
    expect(m).toEqual({
      externalAccountId: "acct-1",
      type: "credit_card",
      displayName: "Plaid Gold Standard 0% Interest Checking",
      institution: "First Platypus Bank",
      mask: "0000",
      creditLimit: 2000,
    });
  });

  it("falls back to name, then a generic label", () => {
    expect(mapAccount({ ...base, officialName: null }, null).displayName).toBe("Plaid Checking");
    expect(mapAccount({ ...base, officialName: "  ", name: "" }, null).displayName).toBe("Connected account");
  });
});
