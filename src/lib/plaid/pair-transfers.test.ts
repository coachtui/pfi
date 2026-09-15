import { describe, expect, it } from "vitest";
import { dayGap, pairTransfers, type PairCandidate } from "./pair-transfers";

function c(over: Partial<PairCandidate> & { ref: string }): PairCandidate {
  return {
    accountRef: "checking",
    accountType: "checking",
    accountArchived: false,
    postedDate: "2026-09-01",
    amount: 500,
    direction: "outflow",
    pfcPrimary: "TRANSFER_OUT",
    alreadyPaired: false,
    ...over,
  };
}
const inflow = (over: Partial<PairCandidate> & { ref: string }) =>
  c({ accountRef: "savings", accountType: "savings", direction: "inflow", pfcPrimary: "TRANSFER_IN", ...over });

describe("pairTransfers", () => {
  it("pairs a unique opposite-direction equal-amount match across two accounts", () => {
    const r = pairTransfers([c({ ref: "o1" }), inflow({ ref: "i1", postedDate: "2026-09-02" })]);
    expect(r).toEqual({ pairs: [{ a: "o1", b: "i1" }], ambiguous: [] });
  });

  it("leaves two equal-amount candidates unpaired and reports all three as ambiguous", () => {
    const r = pairTransfers([c({ ref: "o1" }), inflow({ ref: "i1" }), inflow({ ref: "i2", accountRef: "brokerage", accountType: "brokerage" })]);
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous).toEqual(["i1", "i2", "o1"]);
  });

  it("requires mutual uniqueness: two outflows competing for one inflow pair nothing", () => {
    const r = pairTransfers([c({ ref: "o1" }), c({ ref: "o2", postedDate: "2026-09-03" }), inflow({ ref: "i1", postedDate: "2026-09-02" })]);
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous).toEqual(["i1", "o1", "o2"]);
  });

  it("pairs recurring identical amounts only within their own window", () => {
    const r = pairTransfers([
      c({ ref: "o-sep1", postedDate: "2026-09-01" }), inflow({ ref: "i-sep1", postedDate: "2026-09-01" }),
      c({ ref: "o-sep15", postedDate: "2026-09-15" }), inflow({ ref: "i-sep15", postedDate: "2026-09-16" }),
    ]);
    expect(r.pairs).toEqual([{ a: "o-sep1", b: "i-sep1" }, { a: "o-sep15", b: "i-sep15" }]);
    expect(r.ambiguous).toEqual([]);
  });

  it("respects the date window", () => {
    expect(pairTransfers([c({ ref: "o1", postedDate: "2026-09-01" }), inflow({ ref: "i1", postedDate: "2026-09-04" })]).pairs).toHaveLength(1);
    expect(pairTransfers([c({ ref: "o1", postedDate: "2026-09-01" }), inflow({ ref: "i1", postedDate: "2026-09-05" })]).pairs).toHaveLength(0);
  });

  it("never pairs within the same account, with archived accounts, or with already-paired rows", () => {
    expect(pairTransfers([c({ ref: "o1" }), inflow({ ref: "i1", accountRef: "checking" })]).pairs).toHaveLength(0);
    expect(pairTransfers([c({ ref: "o1" }), inflow({ ref: "i1", accountArchived: true })]).pairs).toHaveLength(0);
    expect(pairTransfers([c({ ref: "o1" }), inflow({ ref: "i1", alreadyPaired: true })]).pairs).toHaveLength(0);
  });

  it("pairs a loan payment with the inflow on a linked liability account, not with a checking inflow", () => {
    const pay = c({ ref: "pay", pfcPrimary: "LOAN_PAYMENTS", amount: 250 });
    const onCard = inflow({ ref: "card", accountRef: "card", accountType: "credit_card", pfcPrimary: "LOAN_PAYMENTS", amount: 250 });
    expect(pairTransfers([pay, onCard]).pairs).toEqual([{ a: "pay", b: "card" }]);
    const onChecking = inflow({ ref: "chk2", accountRef: "checking2", accountType: "checking", pfcPrimary: "LOAN_PAYMENTS", amount: 250 });
    expect(pairTransfers([pay, onChecking]).pairs).toEqual([]);
  });

  it("accepts a transfer-in on a liability account as the landing side of a loan payment", () => {
    const pay = c({ ref: "pay", pfcPrimary: "LOAN_PAYMENTS", amount: 250 });
    const onLoan = inflow({ ref: "loan", accountRef: "auto", accountType: "auto_loan", pfcPrimary: "TRANSFER_IN", amount: 250 });
    expect(pairTransfers([pay, onLoan]).pairs).toEqual([{ a: "pay", b: "loan" }]);
  });

  it("ignores rows that are not transfer-kind (spending, income, unclassified)", () => {
    const r = pairTransfers([
      c({ ref: "o1", pfcPrimary: "FOOD_AND_DRINK" }), inflow({ ref: "i1" }),
      c({ ref: "o2", pfcPrimary: null }), inflow({ ref: "i2", pfcPrimary: "INCOME" }),
    ]);
    expect(r).toEqual({ pairs: [], ambiguous: [] });
  });

  it("matches amounts to the cent only", () => {
    expect(pairTransfers([c({ ref: "o1", amount: 100.01 }), inflow({ ref: "i1", amount: 100 })]).pairs).toHaveLength(0);
    expect(pairTransfers([c({ ref: "o1", amount: 100.004 }), inflow({ ref: "i1", amount: 100 })]).pairs).toHaveLength(1);
  });
});

describe("dayGap", () => {
  it("counts calendar days, symmetric", () => {
    expect(dayGap("2026-09-01", "2026-09-04")).toBe(3);
    expect(dayGap("2026-09-04", "2026-09-01")).toBe(3);
    expect(dayGap("2026-02-28", "2026-03-01")).toBe(1);
  });
});
