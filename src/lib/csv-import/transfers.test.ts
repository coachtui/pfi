import { describe, expect, it } from "vitest";
import type { ExistingTxn, NormalizedRow } from "./types";
import { dayGap, detectTransfers } from "./transfers";

const row = (line: number, over: Partial<NormalizedRow> = {}): NormalizedRow => ({
  line, postedDate: "2026-07-10", amount: 500, direction: "outflow",
  description: "TRANSFER TO SAVINGS", category: "other", ...over,
});
const ex = (id: string, over: Partial<ExistingTxn> = {}): ExistingTxn => ({
  id, accountId: "savings", postedDate: "2026-07-11", amount: 500,
  direction: "inflow", description: "TRANSFER FROM CHECKING", isTransfer: false,
  transferPairId: null, ...over,
});

describe("dayGap", () => {
  it("computes absolute whole-day gaps", () => {
    expect(dayGap("2026-07-10", "2026-07-13")).toBe(3);
    expect(dayGap("2026-07-13", "2026-07-10")).toBe(3);
  });
});

describe("detectTransfers", () => {
  it("pairs an imported row with an opposite existing txn on another account", () => {
    expect(detectTransfers([row(2)], "checking", [ex("e1")])).toEqual([{ line: 2, existingId: "e1" }]);
  });

  it("respects the ±3 day boundary (3 ok, 4 not)", () => {
    expect(detectTransfers([row(2)], "checking", [ex("e1", { postedDate: "2026-07-13" })])).toHaveLength(1);
    expect(detectTransfers([row(2)], "checking", [ex("e1", { postedDate: "2026-07-14" })])).toHaveLength(0);
  });

  it("never pairs same-account, same-direction, unequal-amount, or already-paired candidates", () => {
    expect(detectTransfers([row(2)], "checking", [ex("e1", { accountId: "checking" })])).toHaveLength(0);
    expect(detectTransfers([row(2)], "checking", [ex("e1", { direction: "outflow" })])).toHaveLength(0);
    expect(detectTransfers([row(2)], "checking", [ex("e1", { amount: 499 })])).toHaveLength(0);
    expect(detectTransfers([row(2)], "checking", [ex("e1", { transferPairId: "other" })])).toHaveLength(0);
  });

  it("uses each existing txn at most once, preferring the nearest date then id", () => {
    const pairs = detectTransfers(
      [row(2, { postedDate: "2026-07-11" }), row(3, { postedDate: "2026-07-09" })],
      "checking",
      [ex("e1", { postedDate: "2026-07-11" }), ex("e2", { postedDate: "2026-07-09" })],
    );
    expect(pairs).toEqual([{ line: 2, existingId: "e1" }, { line: 3, existingId: "e2" }]);
    // Two rows, one candidate: only one pair.
    expect(detectTransfers([row(2), row(3)], "checking", [ex("e1")])).toHaveLength(1);
  });
});
