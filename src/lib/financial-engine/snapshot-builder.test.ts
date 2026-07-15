import { describe, expect, it } from "vitest";
import { buildDailySnapshots, type AccountInput, type TransactionInput } from "./snapshot-builder";

const accounts: AccountInput[] = [
  { id: "chk", type: "checking", currentBalance: 5000, includeInCalculations: true },
  { id: "card", type: "credit_card", currentBalance: 1000, includeInCalculations: true },
  { id: "ignored", type: "savings", currentBalance: 99999, includeInCalculations: false },
];

const txn = (t: Partial<TransactionInput> & { id: string; accountId: string; postedDate: string; amount: number; direction: "inflow" | "outflow" }): TransactionInput => ({
  category: null, essential: null, isTransfer: false, transferPairId: null, ...t,
});

// Timeline (endDate 2026-01-16, checking ends at 5000, card ends at 1000):
//  Jan 01  paycheck +2000  (chk, income)
//  Jan 02  rent    −1200   (chk, essential)
//  Jan 05  coffee   −50    (card outflow → card balance +50)
//  Jan 08  card payment: chk −300 (transfer) paired with card +300 (transfer)
//  Jan 10  groceries −100  (chk, essential)
//  Jan 15  paycheck +2000  (chk, income)
const transactions: TransactionInput[] = [
  txn({ id: "t1", accountId: "chk", postedDate: "2026-01-01", amount: 2000, direction: "inflow", category: "income" }),
  txn({ id: "t2", accountId: "chk", postedDate: "2026-01-02", amount: 1200, direction: "outflow", essential: true }),
  txn({ id: "t3", accountId: "card", postedDate: "2026-01-05", amount: 50, direction: "outflow" }),
  txn({ id: "t4", accountId: "chk", postedDate: "2026-01-08", amount: 300, direction: "outflow", isTransfer: true, transferPairId: "t5" }),
  txn({ id: "t5", accountId: "card", postedDate: "2026-01-08", amount: 300, direction: "inflow", isTransfer: true, transferPairId: "t4" }),
  txn({ id: "t6", accountId: "chk", postedDate: "2026-01-10", amount: 100, direction: "outflow", essential: true }),
  txn({ id: "t7", accountId: "chk", postedDate: "2026-01-15", amount: 2000, direction: "inflow", category: "income" }),
];

const config = { startDate: "2026-01-01", endDate: "2026-01-16", safetyBuffer: 500 };

describe("buildDailySnapshots — balance replay", () => {
  const snaps = buildDailySnapshots(accounts, transactions, config);

  it("emits one snapshot per day, oldest first", () => {
    expect(snaps).toHaveLength(16);
    expect(snaps[0].date).toBe("2026-01-01");
    expect(snaps[15].date).toBe("2026-01-16");
  });

  it("reconstructs checking backward from the current balance", () => {
    // chk end Jan16 = 5000. Working backward: Jan15 +2000 ⇒ Jan14 = 3000;
    // Jan10 −100 ⇒ Jan09 = 3100; Jan08 −300 ⇒ Jan07 = 3400;
    // Jan02 −1200 ⇒ Jan01 = 4600; Jan01 +2000 ⇒ Dec31 = 2600.
    expect(snaps.find((s) => s.date === "2026-01-16")!.liquidAssets).toBe(5000);
    expect(snaps.find((s) => s.date === "2026-01-14")!.liquidAssets).toBe(3000);
    expect(snaps.find((s) => s.date === "2026-01-09")!.liquidAssets).toBe(3100);
    expect(snaps.find((s) => s.date === "2026-01-01")!.liquidAssets).toBe(4600);
  });

  it("reconstructs the card as a liability (purchases raise it, payments lower it)", () => {
    // card end = 1000. Backward: Jan08 payment −300 ⇒ Jan07 = 1300;
    // Jan05 purchase +50 ⇒ Jan04 = 1250.
    expect(snaps.find((s) => s.date === "2026-01-16")!.revolvingBalances).toBe(1000);
    expect(snaps.find((s) => s.date === "2026-01-07")!.revolvingBalances).toBe(1300);
    expect(snaps.find((s) => s.date === "2026-01-04")!.revolvingBalances).toBe(1250);
  });

  it("excludes accounts flagged out of calculations", () => {
    expect(snaps[0].liquidAssets).toBeLessThan(10000); // savings 99999 not counted
  });

  it("computes net worth as assets minus liabilities and carries the safety buffer", () => {
    const last = snaps[15];
    expect(last.netWorth).toBe(5000 - 1000);
    expect(last.safetyBuffer).toBe(500);
  });

  it("is deterministic", () => {
    expect(buildDailySnapshots(accounts, transactions, config)).toEqual(snaps);
  });

  it("returns empty for an empty date range or no accounts", () => {
    expect(buildDailySnapshots([], transactions, config)).toEqual([]);
    expect(buildDailySnapshots(accounts, [], { ...config, endDate: "2025-12-31" })).toEqual([]);
  });
});

describe("buildDailySnapshots — obligations", () => {
  const snaps = buildDailySnapshots(accounts, transactions, config);

  it("sums non-transfer liquid outflows plus card-payment transfers before next income", () => {
    // Day Jan 01 → next income Jan 15. Window (Jan01, Jan15]:
    // rent 1200 (Jan02) + card payment transfer 300 (Jan08, pair on card)
    // + groceries 100 (Jan10) = 1600. Coffee (t3) is on the card, not liquid — excluded.
    expect(snaps.find((s) => s.date === "2026-01-01")!.nearTermObligations).toBe(1600);
  });

  it("counts only essential non-transfer outflows as essential obligations", () => {
    // Window (Jan01, Jan15]: rent 1200 + groceries 100 = 1300.
    expect(snaps.find((s) => s.date === "2026-01-01")!.essentialObligations).toBe(1300);
  });

  it("shrinks the window as the next income approaches", () => {
    // Day Jan 09 → window (Jan09, Jan15]: groceries 100 only.
    expect(snaps.find((s) => s.date === "2026-01-09")!.nearTermObligations).toBe(100);
    expect(snaps.find((s) => s.date === "2026-01-09")!.essentialObligations).toBe(100);
  });

  it("uses a previous-cycle proxy when the window runs past endDate", () => {
    // Day Jan 16 has no future income within history. Median gap = 14 (Jan01→Jan15),
    // so the window (Jan16, Jan30] shifts back 28 days to (Dec19, Jan02], which
    // contains the Jan02 rent (1200). Finite, and never reads past endDate.
    expect(snaps.find((s) => s.date === "2026-01-16")!.nearTermObligations).toBe(1200);
    expect(snaps.find((s) => s.date === "2026-01-16")!.essentialObligations).toBe(1200);
  });
});
