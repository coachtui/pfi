import { describe, expect, it } from "vitest";
import { buildDailySnapshots, type AccountInput, type TransactionInput } from "./snapshot-builder";
import { normalizeDescription, seriesKeyOf, type RecurringOverride } from "./recurring";

const accounts: AccountInput[] = [
  { id: "chk", type: "checking", currentBalance: 5000, includeInCalculations: true },
  { id: "card", type: "credit_card", currentBalance: 1000, includeInCalculations: true },
  { id: "ignored", type: "savings", currentBalance: 99999, includeInCalculations: false },
];

const txn = (t: Partial<TransactionInput> & { id: string; accountId: string; postedDate: string; amount: number; direction: "inflow" | "outflow" }): TransactionInput => ({
  description: "", category: null, essential: null, isTransfer: false, transferPairId: null, ...t,
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

const account = (
  a: Partial<AccountInput> & { id: string; type: AccountInput["type"]; currentBalance: number },
): AccountInput => ({ includeInCalculations: true, ...a });

describe("obligations with recurring projection", () => {
  const chk = account({ id: "chk", type: "checking", currentBalance: 5000 });
  const config = { startDate: "2026-05-01", endDate: "2026-06-30", safetyBuffer: 500 };
  // Monthly rent, 3 occurrences → projects 2026-07-01 at 1500.
  const rent = ["2026-04-01", "2026-05-01", "2026-06-01"].map((d, i) =>
    txn({ id: `r${i}`, accountId: "chk", postedDate: d, amount: 1500, direction: "outflow", description: "Rent", essential: true }));
  // Semimonthly-ish monthly payroll, 3 occurrences → projects 2026-07-01.
  const payroll = ["2026-04-01", "2026-05-01", "2026-06-01"].map((d, i) =>
    txn({ id: `p${i}`, accountId: "chk", postedDate: d, amount: 4000, direction: "inflow", description: "Employer payroll", category: "income" }));
  // One-off inside the legacy shifted window (2026-05-23..2026-06-03] but
  // outside the split window's actual span (2026-06-20..2026-06-30].
  const oneOff = txn({ id: "x1", accountId: "chk", postedDate: "2026-05-25", amount: 999, direction: "outflow", description: "Car repair" });
  const all = [...rent, ...payroll, oneOff];

  const snapshotFor = (date: string, overrides: RecurringOverride[] = []) =>
    buildDailySnapshots([chk], all, config, overrides).find((s) => s.date === date)!;

  it("projects recurring outflows into the window beyond endDate instead of shifting", () => {
    // At 2026-06-20: no actual income after that date; recurring payroll
    // projects 2026-07-01 → window (06-20, 07-01]. Actual span (06-20, 06-30]
    // holds no outflows; projection adds rent on 07-01.
    const s = snapshotFor("2026-06-20");
    expect(s.nearTermObligations).toBe(1500);
    expect(s.essentialObligations).toBe(1500);
  });

  it("falls back to the 28-day shift when every outflow series is dismissed", () => {
    const rentKey = seriesKeyOf("chk", "outflow", normalizeDescription("Rent"));
    const s = snapshotFor("2026-06-20", [{ seriesKey: rentKey, status: "dismissed" }]);
    // Legacy shifted window (2026-05-23, 2026-06-03]: rent 1500 + one-off 999.
    expect(s.nearTermObligations).toBe(2499);
    expect(s.essentialObligations).toBe(1500);
  });

  it("keeps windows fully inside known history identical to the pre-recurring behavior", () => {
    const withRecurring = buildDailySnapshots([chk], all, config);
    const dismissedAll = buildDailySnapshots([chk], all, config, [
      { seriesKey: seriesKeyOf("chk", "outflow", normalizeDescription("Rent")), status: "dismissed" },
    ]);
    // 2026-05-10's window ends at the 2026-06-01 payroll — inside history, so
    // projection never engages and overrides change nothing.
    const a = withRecurring.find((s) => s.date === "2026-05-10")!;
    const b = dismissedAll.find((s) => s.date === "2026-05-10")!;
    expect(a.nearTermObligations).toBe(b.nearTermObligations);
  });

  it("projects a confirmed lapsed series but not an unconfirmed one", () => {
    // lastDate 2026-05-02, monthly (interval 30) → nextExpectedDate 2026-06-01,
    // whose +30 step lands exactly on 2026-07-01 — the one day the projected
    // span (2026-06-30, 2026-07-01] at date "2026-06-20" covers. lapsed
    // because daysBetween(05-02, 06-20) = 49 > 45 (1.5x the 30-day interval).
    const lapsed = ["2026-03-03", "2026-04-02", "2026-05-02"].map((d, i) =>
      txn({ id: `l${i}`, accountId: "chk", postedDate: d, amount: 200, direction: "outflow", description: "Old Gym", essential: false }));
    const key = seriesKeyOf("chk", "outflow", normalizeDescription("Old Gym"));
    const base = [...rent, ...payroll, ...lapsed];
    const without = buildDailySnapshots([chk], base, config).find((s) => s.date === "2026-06-20")!;
    expect(without.nearTermObligations).toBe(1500); // lapsed series ignored by default
    const confirmed = buildDailySnapshots([chk], base, config, [{ seriesKey: key, status: "confirmed" }])
      .find((s) => s.date === "2026-06-20")!;
    // Confirming makes the lapsed series project its 07-01 occurrence too.
    expect(confirmed.nearTermObligations).toBe(1700);
    expect(confirmed.essentialObligations).toBe(1500); // Old Gym isn't essential
  });

  it("does not let a detected income series change an obligations window that is already fully inside known history", () => {
    // Weekly payroll, 3 occurrences 7 days apart, last on 2026-05-15 →
    // nextExpectedDate 2026-05-22. Not lapsed at endDate 2026-05-24
    // (9 days <= 1.5x the 7-day interval = 10.5).
    const weeklyPayroll = ["2026-05-01", "2026-05-08", "2026-05-15"].map((d, i) =>
      txn({ id: `wp${i}`, accountId: "chk", postedDate: d, amount: 1000, direction: "inflow", description: "Weekly Payroll", category: "income" }));
    // Lands inside the medianGap-derived window (05-16, 05-23] but outside
    // the income-projection-derived window (05-16, 05-22] — exactly the gap
    // between the two candidate window ends that the bug conflated.
    const carRepair = txn({ id: "cr1", accountId: "chk", postedDate: "2026-05-23", amount: 250, direction: "outflow", description: "Car Repair" });
    const localConfig = { startDate: "2026-04-01", endDate: "2026-05-24", safetyBuffer: 500 };
    const localTxns = [...weeklyPayroll, carRepair];
    const payrollKey = seriesKeyOf("chk", "inflow", normalizeDescription("Weekly Payroll"));

    // 2026-05-16: no actual income date after it (last income was 05-15), so
    // nextIncome is undefined; the medianGap fallback (7 days, from the
    // 05-01→05-08→05-15 gaps) already lands the window at 05-23, at or
    // before endDate — this date is fully "in known history." Whether the
    // recurring income series is left to project (default) or is dismissed
    // must not change the answer.
    const withIncomeSeries = buildDailySnapshots([chk], localTxns, localConfig)
      .find((s) => s.date === "2026-05-16")!;
    const incomeSeriesDismissed = buildDailySnapshots([chk], localTxns, localConfig, [
      { seriesKey: payrollKey, status: "dismissed" },
    ]).find((s) => s.date === "2026-05-16")!;

    expect(withIncomeSeries.nearTermObligations).toBe(incomeSeriesDismissed.nearTermObligations);
    expect(withIncomeSeries.nearTermObligations).toBe(250);
  });
});
