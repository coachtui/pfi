import { describe, expect, it } from "vitest";
import { mapStagedRowsToReviewTransactions, type StagedTransactionRow } from "./review-rows";

function row(partial: Partial<StagedTransactionRow>): StagedTransactionRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    posted_date: "2026-06-01",
    transaction_date: null,
    amount: 10,
    direction: "outflow",
    description: "Test",
    category: null,
    reference_number: null,
    source_page: 1,
    confidence: "high",
    field_confidence: null,
    issues: null,
    excluded: false,
    duplicate_of_transaction_id: null,
    ...partial,
  };
}

describe("mapStagedRowsToReviewTransactions", () => {
  it("assigns unique line numbers starting at 2 (never a shared constant)", () => {
    const out = mapStagedRowsToReviewTransactions([
      row({ id: "a" }),
      row({ id: "b" }),
      row({ id: "c" }),
    ]);
    expect(out.map((r) => r.line)).toEqual([2, 3, 4]);
    expect(new Set(out.map((r) => r.line)).size).toBe(3);
  });

  it("defaults category by direction when null", () => {
    const [inflow, outflow] = mapStagedRowsToReviewTransactions([
      row({ direction: "inflow", category: null }),
      row({ direction: "outflow", category: null }),
    ]);
    expect(inflow.category).toBe("income");
    expect(outflow.category).toBe("other");
  });

  it("coerces amount to number and normalizes issues to a string array", () => {
    const [r] = mapStagedRowsToReviewTransactions([
      row({ amount: "84.20" as unknown as number, issues: ["a", 1, null, "b"] }),
    ]);
    expect(r.amount).toBe(84.2);
    expect(r.issues).toEqual(["a", "b"]);
  });
});
