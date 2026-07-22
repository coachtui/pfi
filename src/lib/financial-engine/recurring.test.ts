import { describe, expect, it } from "vitest";
import { normalizeDescription, seriesKeyOf } from "./recurring";

describe("normalizeDescription", () => {
  it("lowercases and strips reference numbers", () => {
    expect(normalizeDescription("NETFLIX.COM 4529")).toBe("netflix com");
    expect(normalizeDescription("NETFLIX.COM 8817")).toBe("netflix com");
  });

  it("strips date-like runs and collapses whitespace", () => {
    expect(normalizeDescription("ACME PAYROLL 2026-06-01")).toBe("acme payroll");
    expect(normalizeDescription("Rent   #204 07/01")).toBe("rent");
  });

  it("returns empty string for all-numeric descriptions", () => {
    expect(normalizeDescription("123456")).toBe("");
  });
});

describe("seriesKeyOf", () => {
  it("is stable for identical inputs", () => {
    expect(seriesKeyOf("acct-1", "outflow", "rent")).toBe(seriesKeyOf("acct-1", "outflow", "rent"));
  });

  it("is an 8-char lowercase hex string", () => {
    expect(seriesKeyOf("acct-1", "outflow", "rent")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs across account, direction, and description", () => {
    const base = seriesKeyOf("acct-1", "outflow", "rent");
    expect(seriesKeyOf("acct-2", "outflow", "rent")).not.toBe(base);
    expect(seriesKeyOf("acct-1", "inflow", "rent")).not.toBe(base);
    expect(seriesKeyOf("acct-1", "outflow", "mortgage")).not.toBe(base);
  });
});

import { detectRecurringSeries, nextOccurrenceAfter, occurrencesAfter, type RecurringSeries } from "./recurring";
import type { AccountInput, TransactionInput } from "./snapshot-builder";

const CHK: AccountInput = { id: "chk", type: "checking", currentBalance: 1000, includeInCalculations: true };
const CARD: AccountInput = { id: "card", type: "credit_card", currentBalance: 500, includeInCalculations: true };

let seq = 0;
const txn = (t: Partial<TransactionInput> & { postedDate: string; amount: number }): TransactionInput => ({
  id: `t${seq++}`,
  accountId: "chk",
  direction: "outflow",
  description: "Rent",
  category: null,
  essential: null,
  isTransfer: false,
  transferPairId: null,
  ...t,
});

describe("detectRecurringSeries", () => {
  it("detects a monthly series with correct fields", () => {
    const txns = [
      txn({ postedDate: "2026-04-01", amount: 1500, essential: true }),
      txn({ postedDate: "2026-05-01", amount: 1500, essential: true }),
      txn({ postedDate: "2026-06-01", amount: 1500, essential: true }),
    ];
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-15");
    expect(s).toMatchObject({
      displayName: "rent", cadence: "monthly", intervalDays: 30,
      typicalAmount: 1500, variableAmount: false, essential: true,
      isDebtPayment: false, isIncome: false, occurrenceCount: 3,
      lastDate: "2026-06-01", nextExpectedDate: "2026-07-01",
      lapsed: false, confidence: "low",
    });
  });

  it("derives series essential status from category when the flag is left null", () => {
    const txns = [
      txn({ postedDate: "2026-04-01", amount: 1500, category: "housing" }),
      txn({ postedDate: "2026-05-01", amount: 1500, category: "housing" }),
      txn({ postedDate: "2026-06-01", amount: 1500, category: "housing" }),
    ];
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-15");
    expect(s.essential).toBe(true);
  });

  it("does not derive essential status from a non-essential category when the flag is left null", () => {
    const txns = [
      txn({ postedDate: "2026-04-01", amount: 1500, category: "dining" }),
      txn({ postedDate: "2026-05-01", amount: 1500, category: "dining" }),
      txn({ postedDate: "2026-06-01", amount: 1500, category: "dining" }),
    ];
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-15");
    expect(s.essential).toBe(false);
  });

  it("classifies a 1st/15th payroll as semimonthly income", () => {
    const dates = ["2026-04-01", "2026-04-15", "2026-05-01", "2026-05-15", "2026-06-01", "2026-06-15"];
    const txns = dates.map((d) =>
      txn({ postedDate: d, amount: 2600, direction: "inflow", description: "Employer payroll", category: "income" }));
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-20");
    expect(s.cadence).toBe("semimonthly");
    expect(s.isIncome).toBe(true);
    expect(s.confidence).toBe("high");
  });

  it("classifies an every-14-days series as biweekly (day-of-month set exceeds 2)", () => {
    const txns = ["2026-05-01", "2026-05-15", "2026-05-29", "2026-06-12"].map((d) =>
      txn({ postedDate: d, amount: 900, description: "Gym Membership" }));
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-20");
    expect(s.cadence).toBe("biweekly");
  });

  it("flags variable amounts but still qualifies within ±20%", () => {
    const txns = [
      txn({ postedDate: "2026-04-05", amount: 110, description: "Utilities" }),
      txn({ postedDate: "2026-05-05", amount: 100, description: "Utilities" }),
      txn({ postedDate: "2026-06-05", amount: 118, description: "Utilities" }),
    ];
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-20");
    expect(s.variableAmount).toBe(true);
    expect(s.typicalAmount).toBe(110);
  });

  it("rejects a group whose amounts spread beyond tolerance", () => {
    const txns = [
      txn({ postedDate: "2026-04-05", amount: 100, description: "Shopping" }),
      txn({ postedDate: "2026-05-05", amount: 300, description: "Shopping" }),
      txn({ postedDate: "2026-06-05", amount: 700, description: "Shopping" }),
    ];
    expect(detectRecurringSeries([CHK], txns, "2026-06-20")).toHaveLength(0);
  });

  it("rejects irregular gaps and sub-3-occurrence groups", () => {
    const irregular = ["2026-04-01", "2026-04-04", "2026-06-01"].map((d) =>
      txn({ postedDate: d, amount: 50, description: "Coffee" }));
    expect(detectRecurringSeries([CHK], irregular, "2026-06-20")).toHaveLength(0);
    const twoOnly = ["2026-05-01", "2026-06-01"].map((d) =>
      txn({ postedDate: d, amount: 50, description: "Box Sub" }));
    expect(detectRecurringSeries([CHK], twoOnly, "2026-06-20")).toHaveLength(0);
  });

  it("marks a series lapsed when past 1.5x its interval", () => {
    const txns = ["2026-01-10", "2026-02-10", "2026-03-10"].map((d) =>
      txn({ postedDate: d, amount: 45, description: "Old Gym" }));
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-20");
    expect(s.lapsed).toBe(true);
  });

  it("detects debt-payment transfers and excludes other transfers", () => {
    const txns: TransactionInput[] = [];
    for (const [i, d] of ["2026-04-13", "2026-05-13", "2026-06-13"].entries()) {
      txns.push(txn({ id: `out${i}`, postedDate: d, amount: 640, description: "Credit card payment", isTransfer: true, transferPairId: `in${i}` }));
      txns.push(txn({ id: `in${i}`, postedDate: d, amount: 640, direction: "inflow", accountId: "card", description: "Credit card payment", isTransfer: true, transferPairId: `out${i}` }));
    }
    const series = detectRecurringSeries([CHK, CARD], txns, "2026-06-20");
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ isDebtPayment: true, direction: "outflow", accountId: "chk" });
  });

  it("ignores transactions on non-liquid accounts and blank descriptions", () => {
    const txns = [
      ...["2026-04-01", "2026-05-01", "2026-06-01"].map((d) => txn({ postedDate: d, amount: 30, accountId: "card", description: "Streaming" })),
      ...["2026-04-01", "2026-05-01", "2026-06-01"].map((d) => txn({ postedDate: d, amount: 30, description: "12345" })),
    ];
    expect(detectRecurringSeries([CHK, CARD], txns, "2026-06-20")).toHaveLength(0);
  });

  it("merges same-day transactions into one occurrence", () => {
    const txns = [
      txn({ postedDate: "2026-04-01", amount: 700, description: "Rent" }),
      txn({ postedDate: "2026-04-01", amount: 800, description: "Rent" }),
      txn({ postedDate: "2026-05-01", amount: 1500, description: "Rent" }),
      txn({ postedDate: "2026-06-01", amount: 1500, description: "Rent" }),
    ];
    const [s] = detectRecurringSeries([CHK], txns, "2026-06-15");
    expect(s.occurrenceCount).toBe(3);
    expect(s.typicalAmount).toBe(1500);
  });

  it("keeps the same seriesKey when more data reclassifies the cadence", () => {
    const monthly = ["2026-04-01", "2026-05-01", "2026-06-01"].map((d) =>
      txn({ postedDate: d, amount: 100, description: "Flex Plan" }));
    const [a] = detectRecurringSeries([CHK], monthly, "2026-06-15");
    const biweekly = ["2026-04-01", "2026-04-15", "2026-04-29", "2026-05-13", "2026-05-27"].map((d) =>
      txn({ postedDate: d, amount: 100, description: "Flex Plan" }));
    const [b] = detectRecurringSeries([CHK], biweekly, "2026-06-15");
    expect(a.seriesKey).toBe(b.seriesKey);
  });

  it("is deterministic and sorted by seriesKey", () => {
    const txns = [
      ...["2026-04-01", "2026-05-01", "2026-06-01"].map((d) => txn({ postedDate: d, amount: 1500, description: "Rent" })),
      ...["2026-04-05", "2026-05-05", "2026-06-05"].map((d) => txn({ postedDate: d, amount: 110, description: "Utilities" })),
    ];
    const a = detectRecurringSeries([CHK], txns, "2026-06-15");
    const b = detectRecurringSeries([CHK], [...txns].reverse(), "2026-06-15");
    expect(a).toEqual(b);
    expect(a.map((s) => s.seriesKey)).toEqual([...a.map((s) => s.seriesKey)].sort());
  });

  // Contract: detectRecurringSeries filters candidate transactions by account
  // TYPE only (LIQUID_TYPES / LIABILITY_TYPES) — it deliberately does NOT look
  // at includeInCalculations. Every caller is responsible for pre-filtering
  // `accounts` (and any transactions on excluded accounts) down to only
  // includeInCalculations: true accounts before calling this function. This
  // test proves the engine itself still detects a series on an excluded
  // account, so a caller that forgets to pre-filter will silently surface
  // series that don't exist anywhere in the obligations projection.
  //
  // Both current callers must honor this:
  //   - src/lib/data/rebuild-snapshots.ts (`included` — the actual obligations
  //     projection path, buildDailySnapshots)
  //   - src/lib/data/queries.ts (`active` in getRecurringData — the /accounts
  //     Recurring section's list of confirmable/dismissible series)
  // If a future change adds a new caller, it MUST filter accounts by
  // includeInCalculations before passing them in, or confirm/dismiss actions
  // on excluded-account series will silently have no effect on the dashboard.
  it("does not filter by includeInCalculations itself — that is the caller's responsibility", () => {
    const excludedChecking: AccountInput = {
      id: "excluded-chk", type: "checking", currentBalance: 1000, includeInCalculations: false,
    };
    const txns = ["2026-04-01", "2026-05-01", "2026-06-01"].map((d) =>
      txn({ postedDate: d, amount: 1500, description: "Rent", accountId: "excluded-chk" }));
    // The engine has no way to know this account is excluded from
    // calculations — it still qualifies by type (checking is liquid) and
    // still detects the series. Callers MUST pre-filter `accounts` (and
    // transactions) to includeInCalculations: true before calling this.
    const series = detectRecurringSeries([excludedChecking], txns, "2026-06-15");
    expect(series).toHaveLength(1);
    expect(series[0].accountId).toBe("excluded-chk");
  });
});

describe("occurrence projection", () => {
  const series = (over: Partial<RecurringSeries>): RecurringSeries => ({
    seriesKey: "abcd1234", accountId: "chk", direction: "outflow", displayName: "rent",
    cadence: "monthly", intervalDays: 30, typicalAmount: 1500, variableAmount: false,
    essential: true, isDebtPayment: false, isIncome: false, occurrenceCount: 3,
    firstDate: "2026-04-01", lastDate: "2026-06-01", nextExpectedDate: "2026-07-01",
    lapsed: false, confidence: "low", ...over,
  });

  it("lists occurrences in a range, stepping by interval", () => {
    expect(occurrencesAfter(series({}), "2026-06-30", "2026-08-15")).toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("skips occurrences at or before the exclusive lower bound", () => {
    expect(occurrencesAfter(series({}), "2026-07-01", "2026-07-31")).toEqual(["2026-07-31"]);
  });

  it("finds the next occurrence after a date, rolling an overdue series forward", () => {
    expect(nextOccurrenceAfter(series({}), "2026-06-15")).toBe("2026-07-01");
    expect(nextOccurrenceAfter(series({ nextExpectedDate: "2026-05-01" }), "2026-06-15")).toBe("2026-06-30");
  });
});
