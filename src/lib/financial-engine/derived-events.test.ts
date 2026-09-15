import { describe, expect, it } from "vitest";
import { generateKoaHoldings } from "@/lib/demo-data/koa-holdings";
import {
  BONUS_FLOOR, LARGE_PURCHASE_FLOOR, ONE_OFF_MONTHLY_CAP, deriveEvents, oneOffThreshold,
  type DeriveEventsInput, type EventAccountInput, type EventSeriesInput, type EventTransactionInput,
} from "./derived-events";
import { detectRecurringSeries, normalizeDescription, seriesKeyOf } from "./recurring";

const CHK: EventAccountInput = { id: "chk", type: "checking", provider: "plaid", includeInCalculations: true, archived: false };
const SAV: EventAccountInput = { id: "sav", type: "savings", provider: "plaid", includeInCalculations: true, archived: false };
const BRK: EventAccountInput = { id: "brk", type: "brokerage", provider: "plaid", includeInCalculations: true, archived: false };
const CARD: EventAccountInput = { id: "card", type: "credit_card", provider: "plaid", includeInCalculations: true, archived: false };
const MORT: EventAccountInput = { id: "mort", type: "mortgage", provider: "plaid", includeInCalculations: true, archived: false };

let seq = 0;
function txn(over: Partial<EventTransactionInput> & { postedDate: string; amount: number }): EventTransactionInput {
  seq++;
  return {
    id: over.id ?? `t${seq}`, accountId: "chk", direction: "outflow", category: "other", isTransfer: false, transferPairId: null,
    description: over.description ?? `Txn ${seq}`, pfcPrimary: null, pfcDetailed: null, ...over,
  };
}
function series(accountId: string, direction: "inflow" | "outflow", description: string, over: Partial<EventSeriesInput> = {}): EventSeriesInput {
  const norm = normalizeDescription(description);
  return {
    seriesKey: seriesKeyOf(accountId, direction, norm), displayName: norm, cadence: "semimonthly", typicalAmount: 3000,
    occurrenceCount: 6, confidence: "high", isIncome: direction === "inflow", status: null, ...over,
  };
}
/** A transfer pair: outflow on `from`, inflow on `to`, linked both ways. */
function pair(from: string, to: string, date: string, amount: number, desc = "Transfer"): EventTransactionInput[] {
  const n = ++seq;
  const a = txn({ id: `p${n}a`, accountId: from, postedDate: date, amount, direction: "outflow", isTransfer: true, transferPairId: `p${n}b`, description: desc, category: "other" });
  const b = txn({ id: `p${n}b`, accountId: to, postedDate: date, amount, direction: "inflow", isTransfer: true, transferPairId: a.id, description: desc, category: "other" });
  return [a, b];
}
const run = (over: Partial<DeriveEventsInput>) =>
  deriveEvents({ accounts: [CHK, SAV, BRK, CARD, MORT], transactions: [], series: [], ...over });

describe("deriveEvents — paychecks and bonuses", () => {
  const payroll = series("chk", "inflow", "ACME PAYROLL 0412");
  const pay = (date: string, amount = 3000) => txn({ postedDate: date, amount, direction: "inflow", category: "income", description: "ACME PAYROLL 0412" });

  it("derives a paycheck for each occurrence of an eligible income series, labelled from the series", () => {
    const events = run({ transactions: [pay("2026-08-01"), pay("2026-08-15")], series: [payroll] });
    expect(events.map((e) => [e.type, e.date, e.amount, e.label])).toEqual([
      ["paycheck", "2026-08-01", 3000, "Acme Payroll"], ["paycheck", "2026-08-15", 3000, "Acme Payroll"],
    ]);
  });

  it("also derives a paycheck from Plaid's INCOME_SALARY / INCOME_WAGES detail without a series", () => {
    const events = run({ transactions: [txn({ postedDate: "2026-08-01", amount: 2100, direction: "inflow", category: "income", pfcPrimary: "INCOME", pfcDetailed: "INCOME_WAGES", description: "Gig Co" })] });
    expect(events).toEqual([expect.objectContaining({ type: "paycheck", amount: 2100, label: "Gig Co" })]);
  });

  it("ignores dismissed series and low-confidence unconfirmed ones; honours confirmed ones", () => {
    expect(run({ transactions: [pay("2026-08-01")], series: [{ ...payroll, status: "dismissed" }] })).toEqual([]);
    expect(run({ transactions: [pay("2026-08-01")], series: [{ ...payroll, confidence: "low" }] })).toEqual([]);
    expect(run({ transactions: [pay("2026-08-01")], series: [{ ...payroll, confidence: "low", status: "confirmed" }] })).toHaveLength(1);
  });

  it("a quarterly income series is a bonus, not a paycheck", () => {
    const quarterly = series("chk", "inflow", "ACME BONUS", { cadence: "quarterly", typicalAmount: 2500 });
    const events = run({
      transactions: [pay("2026-08-01"), txn({ postedDate: "2026-08-20", amount: 2500, direction: "inflow", category: "income", description: "ACME BONUS" })],
      series: [payroll, quarterly],
    });
    expect(events.map((e) => e.type)).toEqual(["paycheck", "bonus"]);
  });

  it("bonus needs an income series to measure against, a floor, and 1.5× the median paycheck", () => {
    const bonus = (amount: number) => txn({ postedDate: "2026-08-20", amount, direction: "inflow", category: "income", description: "Spot award" });
    expect(run({ transactions: [bonus(9000)], series: [] })).toEqual([]); // no paycheck series → no bonus
    expect(run({ transactions: [bonus(4000)], series: [payroll] })).toEqual([]); // 4000 < 1.5 × 3000
    expect(run({ transactions: [bonus(4500)], series: [payroll] })).toEqual([expect.objectContaining({ type: "bonus", amount: 4500 })]);
    const small = series("chk", "inflow", "Tiny Pay", { typicalAmount: 200 });
    expect(run({ transactions: [bonus(BONUS_FLOOR - 1)], series: [small] })).toEqual([]);
    expect(run({ transactions: [bonus(BONUS_FLOOR)], series: [small] })).toHaveLength(1);
  });

  it("ignores inflows on non-liquid accounts and non-income inflows", () => {
    expect(run({ transactions: [txn({ accountId: "brk", postedDate: "2026-08-01", amount: 5000, direction: "inflow", category: "income", pfcDetailed: "INCOME_WAGES" })] })).toEqual([]);
    expect(run({ transactions: [txn({ postedDate: "2026-08-01", amount: 5000, direction: "inflow", category: "other" })], series: [payroll] })).toEqual([]);
  });
});

describe("deriveEvents — transfers into other accounts", () => {
  it("investment contribution from the outflow side of a pair into brokerage/retirement, counted once", () => {
    const events = run({ transactions: pair("chk", "brk", "2026-08-12", 500, "To Vanguard") });
    expect(events).toEqual([expect.objectContaining({ type: "investment_contribution", amount: 500, direction: "outflow", label: "To Vanguard" })]);
  });

  it("investment contribution from Plaid's detail when the destination is not linked", () => {
    const events = run({ transactions: [txn({ postedDate: "2026-08-12", amount: 400, category: "savings", pfcPrimary: "TRANSFER_OUT", pfcDetailed: "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", description: "Fidelity" })] });
    expect(events.map((e) => e.type)).toEqual(["investment_contribution"]);
  });

  it("a plain savings transfer between liquid accounts is not an event", () => {
    expect(run({ transactions: pair("chk", "sav", "2026-08-12", 500) })).toEqual([]);
  });

  it("debt payment from a pair into a card; mortgage payment from a pair into a mortgage", () => {
    const events = run({ transactions: [...pair("chk", "card", "2026-08-13", 250, "Card payment"), ...pair("chk", "mort", "2026-08-01", 2850, "Mortgage")] });
    expect(events.map((e) => [e.type, e.amount])).toEqual([["mortgage_payment", 2850], ["debt_payment", 250]]);
  });

  it("mortgage from Plaid's detail, and from a recurring housing series whose name says mortgage (CSV data)", () => {
    const fromPlaid = run({ transactions: [txn({ postedDate: "2026-08-01", amount: 2850, category: "housing", pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", description: "WELLS FARGO MORTGAGE" })] });
    expect(fromPlaid.map((e) => e.type)).toEqual(["mortgage_payment"]);
    const s = series("chk", "outflow", "Mortgage payment", { cadence: "monthly", typicalAmount: 2850, isIncome: false });
    const fromSeries = run({ transactions: [txn({ postedDate: "2026-08-01", amount: 2850, category: "housing", description: "Mortgage payment" })], series: [s] });
    expect(fromSeries.map((e) => e.type)).toEqual(["mortgage_payment"]);
  });

  it("debt payoff when the liability's balance history stays at or below zero after the payment", () => {
    const [out, inn] = pair("chk", "card", "2026-08-13", 1200, "Final payment");
    const balances = [
      { accountId: "card", date: "2026-08-12", balance: 1200 }, { accountId: "card", date: "2026-08-13", balance: 0 }, { accountId: "card", date: "2026-08-14", balance: 0 },
    ];
    expect(run({ transactions: [out, inn], liabilityBalances: balances }).map((e) => e.type)).toEqual(["debt_payoff"]);
    expect(run({ transactions: [out, inn], liabilityBalances: [...balances, { accountId: "card", date: "2026-08-20", balance: 40 }] }).map((e) => e.type)).toEqual(["debt_payment"]);
    expect(run({ transactions: [out, inn] }).map((e) => e.type)).toEqual(["debt_payment"]); // no history → never payoff
  });

  it("unpaired LOAN_PAYMENTS (unlinked lender) is a debt payment; tax payments from Plaid's detail", () => {
    const events = run({ transactions: [
      txn({ postedDate: "2026-08-05", amount: 300, category: "debt_payment", pfcPrimary: "LOAN_PAYMENTS", pfcDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", description: "Navient" }),
      txn({ postedDate: "2026-04-15", amount: 1800, category: "other", pfcPrimary: "GOVERNMENT_AND_NON_PROFIT", pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", description: "IRS" }),
    ] });
    expect(events.map((e) => e.type)).toEqual(["tax_payment", "debt_payment"]);
  });

  it("insurance payments only when recurring", () => {
    const s = series("chk", "outflow", "STATE FARM", { cadence: "monthly", typicalAmount: 210, isIncome: false });
    const t = txn({ postedDate: "2026-08-10", amount: 210, category: "insurance", description: "STATE FARM" });
    expect(run({ transactions: [t], series: [s] }).map((e) => e.type)).toEqual(["insurance_payment"]);
    expect(run({ transactions: [t] })).toEqual([]);
  });
});

describe("deriveEvents — one-off purchases (relative threshold + monthly cap)", () => {
  it("oneOffThreshold: floor alone with few samples; max(floor, 2.5 × median) otherwise", () => {
    expect(oneOffThreshold([])).toBe(LARGE_PURCHASE_FLOOR);
    expect(oneOffThreshold([80, 80, 80, 80])).toBe(LARGE_PURCHASE_FLOOR); // 4 samples < 5
    expect(oneOffThreshold([80, 80, 80, 80, 80])).toBe(250); // 2.5 × 80 = 200 → floor wins
    expect(oneOffThreshold([200, 200, 200, 200, 200])).toBe(500); // 2.5 × 200
  });

  it("flags a purchase that clears the household-relative bar and skips one that doesn't", () => {
    // Ten $80 one-offs establish the baseline; then a $260 and a $240 shopping purchase.
    const baseline = Array.from({ length: 10 }, (_, i) => txn({ postedDate: `2026-07-${String(i + 1).padStart(2, "0")}`, amount: 80, category: "dining", description: `Lunch ${i}` }));
    const events = run({ transactions: [...baseline,
      txn({ postedDate: "2026-08-10", amount: 260, category: "shopping", description: "Best Buy" }),
      txn({ postedDate: "2026-08-11", amount: 240, category: "shopping", description: "Target" }),
    ] });
    expect(events.map((e) => [e.type, e.label])).toEqual([["large_purchase", "Best Buy"]]);
  });

  it("scales the bar with the household: $200 typical one-offs need a $500 purchase", () => {
    const baseline = Array.from({ length: 10 }, (_, i) => txn({ postedDate: `2026-07-${String(i + 1).padStart(2, "0")}`, amount: 200, category: "shopping", description: `Shop ${i}` }));
    const events = run({ transactions: [...baseline,
      txn({ postedDate: "2026-08-10", amount: 480, category: "shopping", description: "Under" }),
      txn({ postedDate: "2026-08-11", amount: 500, category: "shopping", description: "At bar" }),
    ] });
    expect(events.map((e) => e.label)).toEqual(["At bar"]);
  });

  it("unexpected expense for health/housing categories or repair details; never for recurring, transfers, or non-spending accounts", () => {
    const events = run({ transactions: [
      txn({ postedDate: "2026-08-10", amount: 900, category: "health", description: "Dentist" }),
      txn({ postedDate: "2026-08-11", amount: 700, category: "transport", pfcPrimary: "GENERAL_SERVICES", pfcDetailed: "GENERAL_SERVICES_AUTOMOTIVE", description: "Brake job" }),
      txn({ postedDate: "2026-08-12", amount: 800, category: "shopping", accountId: "brk", description: "Not spending acct" }),
    ] });
    expect(events.map((e) => [e.type, e.label])).toEqual([["unexpected_expense", "Dentist"], ["unexpected_expense", "Brake job"]]);
  });

  it("keeps only the largest N per type per month", () => {
    const many = Array.from({ length: ONE_OFF_MONTHLY_CAP + 2 }, (_, i) => txn({ postedDate: `2026-08-${String(i + 1).padStart(2, "0")}`, amount: 300 + i * 10, category: "shopping", description: `Buy ${i}` }));
    const events = run({ transactions: many });
    expect(events).toHaveLength(ONE_OFF_MONTHLY_CAP);
    expect(events.map((e) => e.amount)).toEqual([320, 330, 340]); // largest three, date-sorted
  });
});

describe("deriveEvents — scope and determinism", () => {
  it("never derives for demo, archived, or excluded accounts", () => {
    const demo = { ...CHK, id: "demo", provider: "demo" };
    const archived = { ...CHK, id: "arch", archived: true };
    const excluded = { ...CHK, id: "excl", includeInCalculations: false };
    const t = (accountId: string) => txn({ accountId, postedDate: "2026-08-01", amount: 5000, direction: "inflow", category: "income", pfcDetailed: "INCOME_WAGES" });
    expect(run({ accounts: [demo, archived, excluded], transactions: [t("demo"), t("arch"), t("excl")] })).toEqual([]);
  });

  it("respects overrides through the effective category: a purchase recategorized to groceries stops being a driver", () => {
    const t = txn({ postedDate: "2026-08-10", amount: 600, category: "groceries", description: "Costco" });
    expect(run({ transactions: [t] })).toEqual([]);
    expect(run({ transactions: [{ ...t, category: "shopping" }] })).toHaveLength(1);
  });

  it("is deterministic and one event per transaction", () => {
    const input: DeriveEventsInput = { accounts: [CHK, BRK, CARD], transactions: [...pair("chk", "brk", "2026-08-12", 500), txn({ postedDate: "2026-08-10", amount: 600, category: "shopping" })], series: [] };
    const a = deriveEvents(input);
    const b = deriveEvents(input);
    expect(a).toEqual(b);
    expect(new Set(a.map((e) => e.transactionId)).size).toBe(a.length);
  });
});

describe("deriveEvents — reproduces the Koa Holdings generator's authored events", () => {
  const data = generateKoaHoldings();
  const accounts: EventAccountInput[] = data.accounts.map((a) => ({ id: a.id, type: a.type, provider: "plaid", includeInCalculations: a.includeInCalculations, archived: false }));
  const transactions: EventTransactionInput[] = data.transactions.map((t) => ({
    id: t.id, accountId: t.accountId, postedDate: t.postedDate, amount: t.amount, direction: t.direction, category: t.category,
    isTransfer: t.isTransfer, transferPairId: t.transferPairId, description: t.description, pfcPrimary: null, pfcDetailed: null,
  }));
  const detected = detectRecurringSeries(data.accounts, data.transactions, data.config.endDate);
  const seriesInput: EventSeriesInput[] = detected.map((s) => ({
    seriesKey: s.seriesKey, displayName: s.displayName, cadence: s.cadence, typicalAmount: s.typicalAmount,
    occurrenceCount: s.occurrenceCount, confidence: s.confidence, isIncome: s.isIncome, status: null,
  }));
  const derived = deriveEvents({ accounts, transactions, series: seriesInput });
  const key = (e: { type: string; date: string; amount: number }) => `${e.type}|${e.date}|${e.amount.toFixed(2)}`;
  const authored = (type: string) => new Set(data.events.filter((e) => e.type === type).map(key));
  const mine = (type: string) => new Set(derived.filter((e) => e.type === type).map(key));

  it.each(["paycheck", "mortgage_payment", "investment_contribution", "debt_payment"])("%s events match the generator by date and amount", (type) => {
    const a = authored(type);
    const m = mine(type);
    expect([...a].filter((k) => !m.has(k))).toEqual([]); // nothing authored is missed
    expect([...m].filter((k) => !a.has(k))).toEqual([]); // nothing extra invented
  });

  it("bonus and insurance events are found", () => {
    expect(mine("bonus").size).toBe(authored("bonus").size);
    expect(mine("insurance_payment").size).toBe(authored("insurance_payment").size);
  });

  it("large purchases are bounded by the monthly cap and never exceed the generator's own picks by more than the cap allows", () => {
    const byMonth = new Map<string, number>();
    for (const e of derived.filter((e) => e.type === "large_purchase")) byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) ?? 0) + 1);
    for (const n of byMonth.values()) expect(n).toBeLessThanOrEqual(ONE_OFF_MONTHLY_CAP);
  });
});
