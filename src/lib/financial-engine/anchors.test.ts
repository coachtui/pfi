// src/lib/financial-engine/anchors.test.ts
import { describe, expect, it } from "vitest";
import {
  computeDiscrepancy, derivedBalanceAt, effectiveAnchor, rollForwardBalance,
  type BalanceAnchor,
} from "./anchors";
import type { AccountInput, TransactionInput } from "./snapshot-builder";

const CHK: AccountInput = { id: "chk", type: "checking", currentBalance: 0, includeInCalculations: true };
const CARD: AccountInput = { id: "card", type: "credit_card", currentBalance: 0, includeInCalculations: true };

let seq = 0;
const txn = (t: Partial<TransactionInput> & { postedDate: string; amount: number; direction: "inflow" | "outflow" }): TransactionInput => ({
  id: `t${seq++}`,
  accountId: "chk",
  description: "",
  category: null,
  essential: null,
  isTransfer: false,
  transferPairId: null,
  ...t,
});

const anchor = (a: Partial<BalanceAnchor> & { anchorDate: string; balance: number }): BalanceAnchor => ({
  accountId: "chk",
  createdAt: "2026-07-01T00:00:00Z",
  ...a,
});

describe("effectiveAnchor", () => {
  it("picks the greatest anchorDate", () => {
    const a = anchor({ anchorDate: "2026-06-30", balance: 100 });
    const b = anchor({ anchorDate: "2026-07-31", balance: 200 });
    expect(effectiveAnchor([a, b])).toBe(b);
    expect(effectiveAnchor([b, a])).toBe(b);
  });

  it("breaks same-date ties by latest createdAt", () => {
    const first = anchor({ anchorDate: "2026-07-31", balance: 100, createdAt: "2026-08-01T10:00:00Z" });
    const second = anchor({ anchorDate: "2026-07-31", balance: 150, createdAt: "2026-08-01T11:00:00Z" });
    expect(effectiveAnchor([first, second])).toBe(second);
  });

  it("returns null for no anchors", () => {
    expect(effectiveAnchor([])).toBeNull();
  });
});

describe("rollForwardBalance", () => {
  it("adds post-anchor net for asset accounts, ignoring on-or-before-anchor txns", () => {
    const txns = [
      txn({ postedDate: "2026-07-31", amount: 999, direction: "outflow" }), // on anchor date — excluded
      txn({ postedDate: "2026-08-05", amount: 100, direction: "outflow" }),
      txn({ postedDate: "2026-08-10", amount: 250.5, direction: "inflow" }),
    ];
    expect(rollForwardBalance(CHK, 1500, "2026-07-31", txns)).toBe(1650.5);
  });

  it("inverts the sign for liability accounts (purchase raises owed, payment lowers it)", () => {
    const txns = [
      txn({ accountId: "card", postedDate: "2026-08-03", amount: 80, direction: "outflow" }),
      txn({ accountId: "card", postedDate: "2026-08-10", amount: 200, direction: "inflow" }),
    ];
    expect(rollForwardBalance(CARD, 500, "2026-07-31", txns)).toBe(380);
  });

  it("ignores other accounts' transactions and handles empty history", () => {
    const txns = [txn({ accountId: "other", postedDate: "2026-08-05", amount: 100, direction: "inflow" })];
    expect(rollForwardBalance(CHK, 1500, "2026-07-31", txns)).toBe(1500);
    expect(rollForwardBalance(CHK, 1500, "2026-07-31", [])).toBe(1500);
  });

  it("rounds to cents", () => {
    const txns = [
      txn({ postedDate: "2026-08-01", amount: 0.1, direction: "inflow" }),
      txn({ postedDate: "2026-08-02", amount: 0.2, direction: "inflow" }),
    ];
    expect(rollForwardBalance(CHK, 0, "2026-07-31", txns)).toBe(0.3);
  });
});

describe("derivedBalanceAt", () => {
  const a = { balance: 1500, anchorDate: "2026-07-31" };

  it("rolls forward when the date is after the anchor", () => {
    const txns = [txn({ postedDate: "2026-08-05", amount: 100, direction: "outflow" })];
    expect(derivedBalanceAt(CHK, a, "2026-08-10", txns)).toBe(1400);
  });

  it("backs transactions out when the date is before the anchor", () => {
    const txns = [
      txn({ postedDate: "2026-07-15", amount: 2000, direction: "inflow" }),
      txn({ postedDate: "2026-07-20", amount: 300, direction: "outflow" }),
    ];
    // At 07-10 the +2000/-300 hadn't happened yet: 1500 - (2000 - 300) = -200.
    expect(derivedBalanceAt(CHK, a, "2026-07-10", txns)).toBe(-200);
  });

  it("equals the anchor balance on the anchor date itself", () => {
    const txns = [txn({ postedDate: "2026-07-31", amount: 50, direction: "inflow" })];
    // On-date txns are inside the anchor's own truth — not re-applied.
    expect(derivedBalanceAt(CHK, a, "2026-07-31", txns)).toBe(1500);
  });
});

describe("computeDiscrepancy", () => {
  it("returns null when there is no prior anchor", () => {
    expect(computeDiscrepancy(CHK, null, 1600, "2026-07-31", [])).toBeNull();
  });

  it("returns entered minus derived", () => {
    const eff = { balance: 1000, anchorDate: "2026-06-30" };
    const txns = [txn({ postedDate: "2026-07-10", amount: 500, direction: "inflow" })];
    // Derived at 07-31 = 1000 + 500 = 1500; entered 1600 → +100 unexplained.
    expect(computeDiscrepancy(CHK, eff, 1600, "2026-07-31", txns)).toBe(100);
  });

  it("returns 0 when the statement reconciles cleanly", () => {
    const eff = { balance: 1000, anchorDate: "2026-06-30" };
    const txns = [txn({ postedDate: "2026-07-10", amount: 500, direction: "inflow" })];
    expect(computeDiscrepancy(CHK, eff, 1500, "2026-07-31", txns)).toBe(0);
  });

  it("reconciles a back-filled statement dated before the effective anchor", () => {
    const eff = { balance: 1500, anchorDate: "2026-07-31" };
    const txns = [txn({ postedDate: "2026-07-15", amount: 2000, direction: "inflow" })];
    // Derived at 06-30 = 1500 - 2000 = -500; entered -500 → clean.
    expect(computeDiscrepancy(CHK, eff, -500, "2026-06-30", txns)).toBe(0);
  });
});
