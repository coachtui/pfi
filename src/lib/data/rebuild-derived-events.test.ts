import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { derive, type DerivedEventsSource } from "./rebuild-derived-events";

const base: DerivedEventsSource = {
  accounts: [
    { id: "chk", type: "checking", provider: "plaid", include_in_calculations: true, archived_at: null },
    { id: "loan", type: "auto_loan", provider: "plaid", include_in_calculations: true, archived_at: null },
    { id: "excl", type: "checking", provider: "csv", include_in_calculations: false, archived_at: null },
  ],
  transactions: [
    { id: "t1", account_id: "chk", posted_date: "2026-08-10", amount: 900, direction: "outflow", description: "Costco", category: "shopping", essential: null, is_transfer: false, transfer_pair_id: null, user_override: null, pfc_primary: "GENERAL_MERCHANDISE", pfc_detailed: "GENERAL_MERCHANDISE_SUPERSTORES" },
    { id: "t2", account_id: "chk", posted_date: "2026-08-13", amount: 1200, direction: "outflow", description: "Loan payoff", category: "other", essential: null, is_transfer: true, transfer_pair_id: "t3", user_override: null, pfc_primary: null, pfc_detailed: null },
    { id: "t3", account_id: "loan", posted_date: "2026-08-13", amount: 1200, direction: "inflow", description: "Loan payoff", category: "other", essential: null, is_transfer: true, transfer_pair_id: "t2", user_override: null, pfc_primary: null, pfc_detailed: null },
    { id: "t4", account_id: "excl", posted_date: "2026-08-11", amount: 5000, direction: "inflow", description: "Pay", category: "income", essential: null, is_transfer: false, transfer_pair_id: null, user_override: null, pfc_primary: "INCOME", pfc_detailed: "INCOME_WAGES" },
  ],
  recurringOverrides: [],
  anchorsByAccount: new Map([["loan", [{ accountId: "loan", anchorDate: "2026-08-12", balance: 1200, createdAt: "2026-08-12T00:00:00Z" }]]]),
  referenceDate: "2026-08-13",
};

describe("derive (row → engine assembly)", () => {
  it("applies the category override, builds liability history from the anchor, and skips excluded accounts", () => {
    const events = derive(base);
    expect(events.map((e) => [e.type, e.transactionId])).toEqual([["large_purchase", "t1"], ["debt_payoff", "t2"]]);
    const overridden = derive({ ...base, transactions: base.transactions.map((t) => (t.id === "t1" ? { ...t, user_override: { category: "groceries" } } : t)) });
    expect(overridden.map((e) => e.type)).toEqual(["debt_payoff"]);
  });

  it("without an anchor the loan payment is only a payment", () => {
    expect(derive({ ...base, anchorsByAccount: new Map() }).map((e) => e.type)).toEqual(["large_purchase", "debt_payment"]);
  });

  it("returns nothing when every account is demo, archived, or excluded", () => {
    const demoOnly = { ...base, accounts: base.accounts.map((a) => ({ ...a, provider: "demo" })) };
    expect(derive(demoOnly)).toEqual([]);
  });
});
