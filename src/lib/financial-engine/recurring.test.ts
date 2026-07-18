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
