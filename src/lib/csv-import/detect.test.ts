import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse";
import { inferDateFormat, proposeMapping } from "./detect";

describe("proposeMapping", () => {
  it("detects a Chase-style export (Posting Date / Description / Amount)", () => {
    const p = parseCsv("Details,Posting Date,Description,Amount,Type,Balance\nDEBIT,07/01/2026,COFFEE SHOP,-4.50,DEBIT,100.00\n");
    const { mapping, detected } = proposeMapping(p);
    expect(mapping.date).toBe(1);
    expect(mapping.description).toBe(2);
    expect(mapping.amount).toBe(3);
    expect(mapping.debit).toBe(-1);
    expect(detected).toEqual({ date: true, description: true, amount: true, category: false });
  });

  it("detects a debit/credit pair export", () => {
    const p = parseCsv("Date,Payee,Debit,Credit\n01/07/2026,SHOP,4.50,\n");
    const { mapping } = proposeMapping(p);
    expect(mapping.amount).toBe(-1);
    expect(mapping.debit).toBe(2);
    expect(mapping.credit).toBe(3);
  });

  it("detects a category column and leaves unknown layouts undetected", () => {
    const p = parseCsv("Transaction Date,Merchant,Amount,Category\n2026-07-01,SHOP,-1.00,Food\n");
    expect(proposeMapping(p).mapping.category).toBe(3);
    const weird = parseCsv("col1,col2\nx,y\n");
    const { mapping, detected } = proposeMapping(weird);
    expect(mapping.date).toBe(-1);
    expect(detected.date).toBe(false);
  });
});

describe("inferDateFormat", () => {
  it("recognizes ISO as ymd", () => {
    expect(inferDateFormat(["2026-07-01", "2026-07-02"])).toBe("ymd");
  });
  it("uses a >12 first component to pick dmy", () => {
    expect(inferDateFormat(["13/07/2026", "01/07/2026"])).toBe("dmy");
  });
  it("uses a >12 second component to pick mdy, and defaults ambiguous to mdy", () => {
    expect(inferDateFormat(["07/13/2026"])).toBe("mdy");
    expect(inferDateFormat(["01/02/2026"])).toBe("mdy");
  });
});
