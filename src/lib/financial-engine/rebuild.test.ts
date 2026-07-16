import { describe, expect, it } from "vitest";
import { DEFAULT_SAFETY_BUFFER, deriveRebuildConfig } from "./rebuild";
import { buildDailySnapshots, type TransactionInput } from "./snapshot-builder";
import { generateKoaHoldings } from "@/lib/demo-data/koa-holdings";

function txn(postedDate: string): TransactionInput {
  return {
    id: `t-${postedDate}`, accountId: "a1", postedDate, amount: 10,
    direction: "outflow", category: null, essential: null,
    isTransfer: false, transferPairId: null,
  };
}

describe("deriveRebuildConfig", () => {
  it("returns null with no snapshots and no transactions", () => {
    expect(deriveRebuildConfig([], [])).toBeNull();
  });

  it("derives the window from transactions alone, with the default buffer", () => {
    const config = deriveRebuildConfig([], [txn("2026-03-05"), txn("2026-01-10")]);
    expect(config).toEqual({ startDate: "2026-01-10", endDate: "2026-03-05", safetyBuffer: DEFAULT_SAFETY_BUFFER });
  });

  it("keeps the prior snapshot window and buffer when it is wider", () => {
    const prior = [
      { date: "2026-01-01", safetyBuffer: 4000 },
      { date: "2026-06-30", safetyBuffer: 4000 },
    ];
    const config = deriveRebuildConfig(prior, [txn("2026-02-01")]);
    expect(config).toEqual({ startDate: "2026-01-01", endDate: "2026-06-30", safetyBuffer: 4000 });
  });

  it("extends the window when a transaction falls outside prior snapshots", () => {
    const prior = [{ date: "2026-03-01", safetyBuffer: 2500 }];
    const config = deriveRebuildConfig(prior, [txn("2026-01-15"), txn("2026-07-16")]);
    expect(config).toEqual({ startDate: "2026-01-15", endDate: "2026-07-16", safetyBuffer: 2500 });
  });

  it("takes the buffer from the latest prior snapshot", () => {
    const prior = [
      { date: "2026-01-01", safetyBuffer: 1000 },
      { date: "2026-02-01", safetyBuffer: 3000 },
    ];
    expect(deriveRebuildConfig(prior, [])?.safetyBuffer).toBe(3000);
  });
});

describe("rebuild equivalence with the demo pipeline", () => {
  it("re-deriving the config from demo output rebuilds identical snapshots", () => {
    const { accounts, transactions, config } = generateKoaHoldings();
    const original = buildDailySnapshots(accounts, transactions, config);
    const derived = deriveRebuildConfig(
      original.map((s) => ({ date: s.date, safetyBuffer: s.safetyBuffer })),
      transactions,
    );
    expect(derived).not.toBeNull();
    const rebuilt = buildDailySnapshots(accounts, transactions, derived!);
    expect(rebuilt).toEqual(original);
  });
});
