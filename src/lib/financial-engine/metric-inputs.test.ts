import { describe, expect, it } from "vitest";
import type { DailySnapshot } from "./types";
import {
  buildMetricInputs, WINDOW_DAYS,
  type ScoreAccountInput, type ScoreTransactionInput,
} from "./metric-inputs";

const AS_OF = "2026-07-15";

const ACCOUNTS: ScoreAccountInput[] = [
  { id: "chk", type: "checking", institution: "First Bank", currentBalance: 8000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "demo" },
  { id: "sav", type: "savings", institution: "Ally", currentBalance: 12000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "demo" },
  { id: "card", type: "credit_card", institution: "First Bank", currentBalance: 2000, creditLimit: 10000, interestRate: 0.24, includeInCalculations: true, provider: "demo" },
  { id: "brk", type: "brokerage", institution: "Vanguard", currentBalance: 30000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "demo" },
  { id: "house", type: "property", institution: null, currentBalance: 640000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "demo" },
];

function txn(partial: Partial<ScoreTransactionInput> & Pick<ScoreTransactionInput, "id" | "postedDate" | "amount" | "direction">): ScoreTransactionInput {
  return {
    accountId: "chk", category: null, essential: null, isTransfer: false,
    transferPairId: null, description: "", ...partial,
  };
}

function snap(date: string, liquid: number, revolving = 2000): DailySnapshot {
  return {
    date, liquidAssets: liquid, revolvingBalances: revolving,
    nearTermObligations: 3000, essentialObligations: 2000,
    safetyBuffer: 1000, netWorth: 40000,
  };
}

describe("buildMetricInputs", () => {
  it("classifies income, spending, refunds, and excludes plain transfers", () => {
    const inputs = buildMetricInputs(
      [snap("2026-07-14", 19000), snap(AS_OF, 20000)],
      [
        txn({ id: "t1", postedDate: "2026-07-01", amount: 3000, direction: "inflow", category: "income", description: "Employer payroll" }),
        txn({ id: "t2", postedDate: "2026-07-02", amount: 500, direction: "outflow", category: "groceries", essential: true }),
        txn({ id: "t3", postedDate: "2026-07-03", amount: 100, direction: "inflow", category: "shopping", description: "Refund" }), // refund nets spending
        txn({ id: "t4", postedDate: "2026-07-04", amount: 900, direction: "outflow", isTransfer: true, transferPairId: "t5" }),
        txn({ id: "t5", postedDate: "2026-07-04", amount: 900, direction: "inflow", accountId: "sav", isTransfer: true, transferPairId: "t4" }),
      ],
      ACCOUNTS, AS_OF,
    );
    expect(inputs.totals.income).toBe(3000);
    expect(inputs.totals.spending).toBe(400); // 500 - 100 refund; transfer excluded
    expect(inputs.totals.essential).toBe(500);
  });

  it("detects contributions and debt payments from transfer destinations and categories", () => {
    const inputs = buildMetricInputs(
      [snap(AS_OF, 20000)],
      [
        txn({ id: "t1", postedDate: "2026-07-01", amount: 3000, direction: "inflow", category: "income", description: "Employer payroll" }),
        // transfer pair into brokerage → contribution (counted once, from the inflow side)
        txn({ id: "o1", postedDate: "2026-07-05", amount: 500, direction: "outflow", isTransfer: true, transferPairId: "i1" }),
        txn({ id: "i1", postedDate: "2026-07-05", amount: 500, direction: "inflow", accountId: "brk", isTransfer: true, transferPairId: "o1" }),
        // transfer pair into credit card → debt payment
        txn({ id: "o2", postedDate: "2026-07-06", amount: 600, direction: "outflow", isTransfer: true, transferPairId: "i2" }),
        txn({ id: "i2", postedDate: "2026-07-06", amount: 600, direction: "inflow", accountId: "card", isTransfer: true, transferPairId: "o2" }),
        // categorized fallbacks
        txn({ id: "t2", postedDate: "2026-07-07", amount: 200, direction: "outflow", category: "savings" }),
        txn({ id: "t3", postedDate: "2026-07-08", amount: 300, direction: "outflow", category: "debt_payment" }),
      ],
      ACCOUNTS, AS_OF,
    );
    expect(inputs.totals.contributions).toBe(700); // 500 transfer + 200 categorized
    expect(inputs.totals.debtPayments).toBe(900);  // 600 transfer + 300 categorized
    // categorized debt payment is also ordinary spending (an obligation); savings category is not
    expect(inputs.totals.spending).toBe(300);
  });

  it("buckets flows into three 30-day buckets ending at asOf", () => {
    const inputs = buildMetricInputs(
      [snap(AS_OF, 20000)],
      [
        txn({ id: "a", postedDate: "2026-07-10", amount: 100, direction: "outflow", category: "dining" }),  // bucket 2 (most recent)
        txn({ id: "b", postedDate: "2026-06-01", amount: 100, direction: "outflow", category: "dining" }),  // bucket 1
        txn({ id: "c", postedDate: "2026-04-20", amount: 100, direction: "outflow", category: "dining" }),  // bucket 0 (oldest)
        txn({ id: "d", postedDate: "2026-04-01", amount: 999, direction: "outflow", category: "dining" }),  // outside window → dropped
      ],
      ACCOUNTS, AS_OF,
    );
    expect(inputs.buckets).toHaveLength(3);
    expect(inputs.buckets.map((b) => b.spending)).toEqual([100, 100, 100]);
  });

  it("groups income sources and flags recurring ones (seen in ≥2 buckets)", () => {
    const inputs = buildMetricInputs(
      [snap(AS_OF, 20000)],
      [
        txn({ id: "p1", postedDate: "2026-05-01", amount: 3000, direction: "inflow", category: "income", description: "Employer Payroll" }),
        txn({ id: "p2", postedDate: "2026-06-01", amount: 3000, direction: "inflow", category: "income", description: "employer payroll " }),
        txn({ id: "b1", postedDate: "2026-07-01", amount: 2000, direction: "inflow", category: "income", description: "Quarterly bonus" }),
      ],
      ACCOUNTS, AS_OF,
    );
    const payroll = inputs.incomeSources.find((s) => s.source === "employer payroll");
    expect(payroll).toMatchObject({ total: 6000, recurring: true });
    expect(inputs.incomeSources.find((s) => s.source === "quarterly bonus")).toMatchObject({ recurring: false });
    expect(inputs.recurringIncomeMonthlyAvg).toBe(2000); // 6000 / 3 buckets
  });

  it("computes institution shares over custodial accounts only, excluding property", () => {
    const inputs = buildMetricInputs([snap(AS_OF, 20000)], [], ACCOUNTS, AS_OF);
    // custodial assets: chk 8000 (First Bank) + sav 12000 (Ally) + brk 30000 (Vanguard) = 50000.
    // The $640,000 "house" (property) account must not be counted — it's not custodial risk.
    expect(inputs.institutionShares[0]).toBeCloseTo(0.6); // Vanguard
    expect(inputs.institutionShares.length).toBe(3); // First Bank, Ally, Vanguard — not property's "—"
    expect(inputs.debtAccounts).toEqual([{ balance: 2000, rate: 0.24 }]);
    expect(inputs.revolvingLimitTotal).toBe(10000);
  });

  it("respects includeInCalculations, tracks history and demo flag", () => {
    const excluded = ACCOUNTS.map((a) => a.id === "brk" ? { ...a, includeInCalculations: false } : a);
    const inputs = buildMetricInputs(
      [snap("2026-06-01", 100), snap(AS_OF, 20000)],
      [txn({ id: "i1", postedDate: "2026-07-05", amount: 500, direction: "inflow", accountId: "brk", isTransfer: true, transferPairId: "x" })],
      excluded, AS_OF,
    );
    expect(inputs.totals.contributions).toBe(0); // excluded account's inflow ignored
    expect(inputs.institutionShares).toHaveLength(2); // Vanguard (excluded) no longer counted
    expect(inputs.historyDays).toBe(45); // 2026-06-01 → 2026-07-15 inclusive
    expect(inputs.dataQuality.demo).toBe(true);
    expect(inputs.snapshot?.liquidAssets).toBe(20000);
  });
});
