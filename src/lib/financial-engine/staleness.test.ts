import { describe, expect, it } from "vitest";
import {
  accountFreshness, householdFreshness, isStale, nudgeVisible,
  STALE_AFTER_DAYS, type AccountFreshnessInput,
} from "./staleness";

const acct = (a: Partial<AccountFreshnessInput> & { id: string }): AccountFreshnessInput => ({
  provider: "manual",
  includeInCalculations: true,
  archived: false,
  anchorDate: null,
  newestTxnDate: null,
  ...a,
});

describe("accountFreshness", () => {
  it("prefers the anchor date over the newest transaction date", () => {
    // The anchor is the verified point; newer unanchored txns don't count as "verified through".
    expect(accountFreshness(acct({ id: "a", anchorDate: "2026-07-31", newestTxnDate: "2026-08-05" }))).toBe("2026-07-31");
  });
  it("falls back to newest transaction date, then null", () => {
    expect(accountFreshness(acct({ id: "a", newestTxnDate: "2026-06-15" }))).toBe("2026-06-15");
    expect(accountFreshness(acct({ id: "a" }))).toBeNull();
  });
});

describe("householdFreshness", () => {
  it("is the OLDEST freshness across included, non-archived, non-demo accounts", () => {
    const accounts = [
      acct({ id: "a", anchorDate: "2026-07-31" }),
      acct({ id: "b", anchorDate: "2026-06-30" }),
    ];
    expect(householdFreshness(accounts)).toBe("2026-06-30");
  });

  it("excludes demo, excluded, and archived accounts", () => {
    const accounts = [
      acct({ id: "a", anchorDate: "2026-07-31" }),
      acct({ id: "demo", provider: "demo", anchorDate: "2026-01-01" }),
      acct({ id: "excl", includeInCalculations: false, anchorDate: "2026-01-01" }),
      acct({ id: "arch", archived: true, anchorDate: "2026-01-01" }),
    ];
    expect(householdFreshness(accounts)).toBe("2026-07-31");
  });

  it("skips accounts with no freshness rather than treating them as infinitely stale", () => {
    expect(householdFreshness([acct({ id: "new" }), acct({ id: "a", anchorDate: "2026-07-01" })])).toBe("2026-07-01");
  });

  it("returns null for demo-only households", () => {
    expect(householdFreshness([acct({ id: "d", provider: "demo", anchorDate: "2026-06-01" })])).toBeNull();
  });
});

describe("isStale", () => {
  it("uses the exact 35-day threshold", () => {
    expect(STALE_AFTER_DAYS).toBe(35);
    expect(isStale("2026-06-13", "2026-07-18")).toBe(false); // exactly 35 days — not yet stale
    expect(isStale("2026-06-12", "2026-07-18")).toBe(true);  // 36 days
    expect(isStale(null, "2026-07-18")).toBe(false);         // no data = no nag
  });
});

describe("nudgeVisible", () => {
  const stale = "2026-05-01";
  const today = "2026-07-18";
  it("shows when stale and never dismissed", () => {
    expect(nudgeVisible(stale, today, null)).toBe(true);
  });
  it("hides for 35 days after dismissal, then returns", () => {
    expect(nudgeVisible(stale, today, "2026-07-01")).toBe(false); // 17 days ago
    expect(nudgeVisible(stale, today, "2026-06-01")).toBe(true);  // 47 days ago
  });
  it("never shows when fresh, regardless of dismissal state", () => {
    expect(nudgeVisible("2026-07-10", today, null)).toBe(false);
  });
});
