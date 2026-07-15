import { describe, expect, it } from "vitest";
import { enumeratePeriods, latestCompletePeriod } from "./report";
import type { DailySnapshot } from "./types";

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
