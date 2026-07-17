import { describe, expect, it } from "vitest";
import type { ExistingTxn, NormalizedRow } from "./types";
import { dedupeKey, markDuplicates } from "./dedupe";

const row = (line: number, over: Partial<NormalizedRow> = {}): NormalizedRow => ({
  line, postedDate: "2026-07-01", amount: 10, direction: "outflow",
  description: "Coffee Shop", category: "other", ...over,
});
const existing = (over: Partial<ExistingTxn> = {}): ExistingTxn => ({
  id: "e1", accountId: "acct-1", postedDate: "2026-07-01", amount: 10,
  direction: "outflow", description: "COFFEE   shop", isTransfer: false,
  transferPairId: null, ...over,
});

describe("dedupeKey", () => {
  it("case-folds and collapses whitespace in descriptions", () => {
    expect(dedupeKey("a", row(2))).toBe(dedupeKey("a", row(3, { description: "  coffee   SHOP " })));
  });
});

describe("markDuplicates", () => {
  it("skips rows matching existing transactions on the same account only", () => {
    const r = markDuplicates([row(2)], "acct-1", [existing()]);
    expect(r.fresh).toEqual([]);
    expect(r.duplicates.map((d) => d.line)).toEqual([2]);
    // Same values on a different account are not duplicates.
    expect(markDuplicates([row(2)], "acct-2", [existing()]).fresh).toHaveLength(1);
  });

  it("detects intra-file duplicates, keeping the first occurrence", () => {
    const r = markDuplicates([row(2), row(3)], "acct-1", []);
    expect(r.fresh.map((d) => d.line)).toEqual([2]);
    expect(r.duplicates.map((d) => d.line)).toEqual([3]);
  });

  it("near-misses are not duplicates (one cent / one day / direction)", () => {
    const r = markDuplicates(
      [row(2, { amount: 10.01 }), row(3, { postedDate: "2026-07-02" }), row(4, { direction: "inflow" })],
      "acct-1",
      [existing()],
    );
    expect(r.fresh).toHaveLength(3);
    expect(r.duplicates).toHaveLength(0);
  });
});
