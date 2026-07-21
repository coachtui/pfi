import { describe, expect, it } from "vitest";
import { fileSha256, likelyDuplicateTransaction, statementTransactionFingerprint } from "./dedupe";

describe("fileSha256", () => {
  it("detects duplicate document bytes with a stable cryptographic hash", () => {
    const a = new TextEncoder().encode("fictional statement");
    const b = new TextEncoder().encode("fictional statement");
    expect(fileSha256(a)).toBe(fileSha256(b));
    expect(fileSha256(a)).not.toBe(fileSha256(new TextEncoder().encode("other")));
  });
});

describe("statementTransactionFingerprint", () => {
  it("includes account, normalized transaction fields, reference, and statement period", () => {
    const row = { line: 2, postedDate: "2026-07-01", amount: 12, direction: "outflow" as const, description: "Coffee", category: "other" as const, referenceNumber: "R1" };
    expect(statementTransactionFingerprint("acct", row, "2026-07-31")).toContain("r1");
    expect(statementTransactionFingerprint("acct", row, "2026-07-31")).not.toBe(statementTransactionFingerprint("acct", { ...row, referenceNumber: "R2" }, "2026-07-31"));
  });
});

describe("likelyDuplicateTransaction", () => {
  it("reuses CSV dedupe identity for overlapping imports", () => {
    const row = { line: 2, postedDate: "2026-07-01", amount: 12, direction: "outflow" as const, description: "Coffee", category: "other" as const };
    const duplicate = likelyDuplicateTransaction("acct", row, [{
      id: "t1", accountId: "acct", postedDate: "2026-07-01", amount: 12,
      direction: "outflow", description: " coffee ", isTransfer: false, transferPairId: null,
    }]);
    expect(duplicate?.id).toBe("t1");
  });
});
