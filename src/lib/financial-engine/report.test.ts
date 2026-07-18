import { describe, expect, it } from "vitest";
import { enumeratePeriods, latestCompletePeriod, buildManagementCommentary } from "./report";
import type { DailySnapshot } from "./types";
import { computePeriodStatement } from "./report";
import type { FinancialEvent, IndexPoint } from "./types";
import type { TransactionInput } from "./snapshot-builder";
import type { PeriodStatement } from "./report";
import { buildDailySnapshots } from "./snapshot-builder";
import { buildIndexSeries } from "./indexing";
import { generateKoaHoldings } from "../demo-data/koa-holdings";

const snap = (date: string): DailySnapshot => ({
  date, liquidAssets: 0, revolvingBalances: 0, nearTermObligations: 0,
  essentialObligations: 0, safetyBuffer: 0, netWorth: 0,
});

// Daily snapshots from 2026-05-10 through 2026-07-15.
function dailySnapshots(start: string, end: string): DailySnapshot[] {
  const out: DailySnapshot[] = [];
  for (let d = start; d <= end; ) {
    out.push(snap(d));
    const [y, m, dd] = d.split("-").map(Number);
    d = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
  }
  return out;
}

describe("enumeratePeriods — monthly", () => {
  const periods = enumeratePeriods(dailySnapshots("2026-05-10", "2026-07-15"), "monthly");

  it("buckets each calendar month spanned by the data", () => {
    expect(periods.map((p) => p.label)).toEqual(["May 2026", "June 2026", "July 2026"]);
    expect(periods.map((p) => p.key)).toEqual(["2026-M05", "2026-M06", "2026-M07"]);
  });

  it("marks a month complete only when its full span is within the data", () => {
    // May starts 05-01 but data starts 05-10 → incomplete; July ends 07-31 but data ends 07-15 → incomplete.
    expect(periods.find((p) => p.key === "2026-M05")!.complete).toBe(false);
    expect(periods.find((p) => p.key === "2026-M06")!.complete).toBe(true);
    expect(periods.find((p) => p.key === "2026-M07")!.complete).toBe(false);
  });

  it("uses correct month bounds", () => {
    const june = periods.find((p) => p.key === "2026-M06")!;
    expect(june.start).toBe("2026-06-01");
    expect(june.end).toBe("2026-06-30");
  });
});

describe("enumeratePeriods — quarterly", () => {
  const periods = enumeratePeriods(dailySnapshots("2026-05-10", "2026-07-15"), "quarterly");

  it("buckets each quarter spanned by the data", () => {
    expect(periods.map((p) => p.label)).toEqual(["Q2 2026", "Q3 2026"]);
    expect(periods.map((p) => [p.start, p.end])).toEqual([
      ["2026-04-01", "2026-06-30"],
      ["2026-07-01", "2026-09-30"],
    ]);
  });

  it("marks both quarters incomplete (data starts mid-Q2, ends mid-Q3)", () => {
    expect(periods.every((p) => !p.complete)).toBe(true);
  });
});

describe("latestCompletePeriod", () => {
  it("returns the last complete period", () => {
    const periods = enumeratePeriods(dailySnapshots("2026-05-10", "2026-07-15"), "monthly");
    expect(latestCompletePeriod(periods)!.key).toBe("2026-M06");
  });

  it("falls back to the last period when none are complete", () => {
    const periods = enumeratePeriods(dailySnapshots("2026-05-10", "2026-07-15"), "quarterly");
    expect(latestCompletePeriod(periods)!.key).toBe("2026-Q3");
  });

  it("returns null for empty input", () => {
    expect(latestCompletePeriod([])).toBeNull();
    expect(enumeratePeriods([], "monthly")).toEqual([]);
  });
});

const txn = (
  postedDate: string, amount: number, direction: "inflow" | "outflow",
  opts: Partial<TransactionInput> = {},
): TransactionInput => ({
  id: `${postedDate}-${amount}-${direction}`, accountId: "chk", postedDate, amount, direction,
  description: "", category: null, essential: null, isTransfer: false, transferPairId: null, ...opts,
});

// A tiny hand-computed June with a May-31 prev snapshot for exact deltas.
const stmtSnapshots: DailySnapshot[] = [
  { date: "2026-05-31", liquidAssets: 10000, revolvingBalances: 2000, nearTermObligations: 0, essentialObligations: 0, safetyBuffer: 0, netWorth: 100000 },
  { date: "2026-06-30", liquidAssets: 11200, revolvingBalances: 1800, nearTermObligations: 0, essentialObligations: 0, safetyBuffer: 0, netWorth: 101900 },
];
// Flows in June: income 6400 (two paychecks), spending 4500 (non-transfer outflows),
// an investment transfer 500 (isTransfer, excluded from opex), a card payment transfer 300 (excluded).
const stmtTxns: TransactionInput[] = [
  txn("2026-06-01", 3200, "inflow", { category: "income" }),
  txn("2026-06-15", 3200, "inflow", { category: "income" }),
  txn("2026-06-05", 2850, "outflow", { category: "housing", essential: true }),
  txn("2026-06-20", 1650, "outflow", { category: "discretionary" }),
  txn("2026-06-12", 500, "outflow", { isTransfer: true, transferPairId: "p1" }),
  txn("2026-06-13", 300, "outflow", { isTransfer: true, transferPairId: "p2" }),
  txn("2026-05-20", 9999, "inflow", { category: "income" }), // out of range
];
const stmtEvents: FinancialEvent[] = [
  { id: "e1", date: "2026-06-12", type: "investment_contribution", label: "Investment", amount: 500, direction: "outflow" },
  { id: "e2", date: "2026-05-12", type: "investment_contribution", label: "Investment", amount: 500, direction: "outflow" },
];
const stmtIndex: IndexPoint[] = [
  { date: "2026-05-31", actual: 110, baseline: 108, waterline: 90 },
  { date: "2026-06-30", actual: 118.4, baseline: 112, waterline: 91 },
];
const junePeriod = { key: "2026-M06", label: "June 2026", start: "2026-06-01", end: "2026-06-30", complete: true };

describe("computePeriodStatement", () => {
  const s = computePeriodStatement(stmtSnapshots, stmtTxns, stmtEvents, stmtIndex, junePeriod);

  it("sums revenue from in-range income inflows only", () => {
    expect(s.revenue).toBe(6400);
  });

  it("sums operating expenses from in-range non-transfer outflows only", () => {
    expect(s.operatingExpenses).toBe(4500); // 2850 + 1650; transfers excluded
  });

  it("computes free cash flow", () => {
    expect(s.freeCashFlow).toBe(1900);
  });

  it("reads savings and debt reduction from snapshot deltas", () => {
    expect(s.savings).toBe(1200); // 11200 - 10000
    expect(s.debtReduction).toBe(200); // 2000 - 1800
  });

  it("reads investments from in-range investment_contribution events", () => {
    expect(s.investments).toBe(500);
  });

  it("owner-created equity is savings + investments + debt reduction", () => {
    expect(s.ownerCreatedEquity).toBe(1900);
    expect(s.marketAppreciation).toBe(0);
  });

  it("reconciles: free cash flow equals owner-created equity (demo identity)", () => {
    expect(s.ownerCreatedEquity).toBeCloseTo(s.freeCashFlow, 2);
  });

  it("computes index movement over the period", () => {
    expect(s.indexStart).toBe(110);
    expect(s.indexEnd).toBe(118.4);
    expect(s.indexChange).toBeCloseTo(8.4, 2);
  });

  it("computes savings rate as a percent of revenue", () => {
    expect(s.savingsRatePct).toBeCloseTo(18.75, 2); // 1200 / 6400
  });

  it("returns zeroes without NaN for a period entirely before any snapshot data, and the reconciliation identity still holds", () => {
    const empty = computePeriodStatement(
      stmtSnapshots, [], [], stmtIndex,
      { key: "2026-M01", label: "January 2026", start: "2026-01-01", end: "2026-01-31", complete: false },
    );
    expect(empty.revenue).toBe(0);
    expect(empty.operatingExpenses).toBe(0);
    expect(empty.savings).toBe(0);
    expect(empty.investments).toBe(0);
    expect(empty.debtReduction).toBe(0);
    expect(empty.ownerCreatedEquity).toBe(0);
    expect(empty.freeCashFlow).toBe(0);
    expect(empty.savingsRatePct).toBe(0);
    expect(Number.isNaN(empty.ownerCreatedEquity)).toBe(false);
  });

  it("returns a zero delta without NaN for a period entirely after any snapshot data", () => {
    const future = computePeriodStatement(
      stmtSnapshots, [], [], stmtIndex,
      { key: "2026-M12", label: "December 2026", start: "2026-12-01", end: "2026-12-31", complete: false },
    );
    expect(future.savings).toBe(0);
    expect(future.debtReduction).toBe(0);
    expect(future.ownerCreatedEquity).toBe(0);
    expect(future.freeCashFlow).toBe(0);
    expect(Number.isNaN(future.ownerCreatedEquity)).toBe(false);
  });
});

describe("buildManagementCommentary", () => {
  const lines = buildManagementCommentary(
    computePeriodStatement(stmtSnapshots, stmtTxns, stmtEvents, stmtIndex, junePeriod),
    "Koa Holdings",
  );
  const text = lines.join(" ");

  it("names the company and period", () => {
    expect(text).toContain("Koa Holdings");
    expect(text).toContain("June 2026");
  });

  it("states the actual computed figures", () => {
    expect(text).toContain("$6,400"); // revenue
    expect(text).toContain("$4,500"); // operating expenses
    expect(text).toContain("$1,900"); // free cash flow / owner equity
    expect(text).toContain("8.4"); // index movement
  });

  it("returns several sentences", () => {
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it("uses correct phrasing for negative owner-created equity", () => {
    const negativeEquityStatement: PeriodStatement = {
      period: junePeriod,
      revenue: 5000,
      operatingExpenses: 3000,
      freeCashFlow: 2000,
      savings: 1000,
      investments: 500,
      debtReduction: 200,
      ownerCreatedEquity: -300,
      marketAppreciation: 0,
      indexStart: 100,
      indexEnd: 100,
      indexChange: 0,
      savingsRatePct: 20,
    };
    const commentaryLines = buildManagementCommentary(negativeEquityStatement, "Test Corp");
    const commentary = commentaryLines.join(" ");

    // Should contain the correct phrasing for negative equity
    expect(commentary).toContain("reducing owner-created equity by $300");

    // Should NOT contain a double-negative (minus sign immediately after "reducing")
    expect(commentary).not.toMatch(/reducing\s+−/);
  });

  it('uses "shortfall" instead of "surplus" when free cash flow is negative', () => {
    const negativeFcfStatement: PeriodStatement = {
      period: junePeriod,
      revenue: 3000,
      operatingExpenses: 5000,
      freeCashFlow: -2000,
      savings: -1500,
      investments: 0,
      debtReduction: -500,
      ownerCreatedEquity: -2000,
      marketAppreciation: 0,
      indexStart: 100,
      indexEnd: 98,
      indexChange: -2,
      savingsRatePct: 0,
    };
    const commentary = buildManagementCommentary(negativeFcfStatement, "Test Corp").join(" ");

    expect(commentary).toContain("shortfall");
    expect(commentary).not.toContain("surplus");
  });

  it('uses "surplus" (not "shortfall") when free cash flow is positive', () => {
    const positiveFcfStatement: PeriodStatement = {
      period: junePeriod,
      revenue: 6400,
      operatingExpenses: 4500,
      freeCashFlow: 1900,
      savings: 1200,
      investments: 500,
      debtReduction: 200,
      ownerCreatedEquity: 1900,
      marketAppreciation: 0,
      indexStart: 110,
      indexEnd: 118.4,
      indexChange: 8.4,
      savingsRatePct: 18.75,
    };
    const commentary = buildManagementCommentary(positiveFcfStatement, "Test Corp").join(" ");

    expect(commentary).toContain("surplus");
    expect(commentary).not.toContain("shortfall");
  });
});

describe("computePeriodStatement — real pipeline", () => {
  // End-to-end reconciliation against the actual demo data pipeline (not
  // just hand-built fixtures). Regression coverage for a real bug: a
  // "leading partial" period — one whose nominal start predates the
  // earliest snapshot but that genuinely overlaps real data — used to
  // fabricate a savings/debt-reduction delta of zero (or, after a first
  // fix attempt, double count the earliest data day's transactions and
  // events), breaking freeCashFlow === ownerCreatedEquity by hundreds of
  // dollars. This asserts the identity holds for every period the real
  // Koa Holdings dataset produces, at both granularities.
  const dataset = generateKoaHoldings();
  const snapshots = buildDailySnapshots(dataset.accounts, dataset.transactions, dataset.config);
  const { points: indexPoints } = buildIndexSeries(snapshots);

  it("has real snapshot data to exercise (sanity check)", () => {
    expect(snapshots.length).toBeGreaterThan(300);
  });

  it.each(["monthly", "quarterly"] as const)(
    "reconciles freeCashFlow === ownerCreatedEquity for every %s period",
    (granularity) => {
      const periods = enumeratePeriods(snapshots, granularity);
      expect(periods.length).toBeGreaterThan(0);

      for (const period of periods) {
        const s = computePeriodStatement(
          snapshots, dataset.transactions, dataset.events, indexPoints, period,
        );
        expect(
          Math.abs(s.freeCashFlow - s.ownerCreatedEquity),
          `${granularity} period ${period.key} (${period.label}): freeCashFlow=${s.freeCashFlow} ` +
          `ownerCreatedEquity=${s.ownerCreatedEquity} diverge by ` +
          `${Math.abs(s.freeCashFlow - s.ownerCreatedEquity)}`,
        ).toBeLessThan(0.01);
      }
    },
  );
});
