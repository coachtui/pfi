import { describe, expect, it } from "vitest";
import type { ColumnMapping } from "./types";
import { normalizeRows, parseAmountToken, parseDateToken } from "./normalize";
import { parseCsv } from "./parse";

const base: ColumnMapping = {
  date: 0, description: 1, amount: 2, debit: -1, credit: -1, category: -1,
  dateFormat: "mdy", signConvention: "positive_inflow", categoryValues: {},
};

describe("parseDateToken", () => {
  it("reads the ambiguous 03/04/2025 both ways", () => {
    expect(parseDateToken("03/04/2025", "mdy")).toBe("2025-03-04");
    expect(parseDateToken("03/04/2025", "dmy")).toBe("2025-04-03");
  });
  it("handles ymd, 2-digit years, and rejects garbage/invalid dates", () => {
    expect(parseDateToken("2026-07-01", "ymd")).toBe("2026-07-01");
    expect(parseDateToken("7/1/26", "mdy")).toBe("2026-07-01");
    expect(parseDateToken("02/30/2026", "mdy")).toBeNull();
    expect(parseDateToken("hello", "mdy")).toBeNull();
  });
});

describe("parseAmountToken", () => {
  it("handles currency symbols, thousands separators, parens-negative, signs", () => {
    expect(parseAmountToken("$1,234.56")).toBe(1234.56);
    expect(parseAmountToken("(45.00)")).toBe(-45);
    expect(parseAmountToken("-12.30")).toBe(-12.3);
    expect(parseAmountToken("+7")).toBe(7);
    expect(parseAmountToken("abc")).toBeNull();
    expect(parseAmountToken("")).toBeNull();
  });
});

describe("normalizeRows", () => {
  it("normalizes signed amounts with direction defaults for category", () => {
    const p = parseCsv("Date,Desc,Amount\n07/01/2026,PAYCHECK,1000\n07/02/2026,COFFEE,-4.50\n");
    const r = normalizeRows(p, base);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, postedDate: "2026-07-01", amount: 1000, direction: "inflow", description: "PAYCHECK", category: "income" },
      { line: 3, postedDate: "2026-07-02", amount: 4.5, direction: "outflow", description: "COFFEE", category: "other" },
    ]);
  });

  it("respects positive_outflow sign convention", () => {
    const p = parseCsv("Date,Desc,Amount\n07/01/2026,CHARGE,4.50\n");
    const r = normalizeRows(p, { ...base, signConvention: "positive_outflow" });
    expect(r.rows[0].direction).toBe("outflow");
  });

  it("handles debit/credit pairs and rejects both-empty and both-filled", () => {
    const p = parseCsv("Date,Desc,Debit,Credit\n07/01/2026,SHOP,4.50,\n07/02/2026,DEPOSIT,,20\n07/03/2026,BAD,,\n07/04/2026,BAD2,1,2\n");
    const m = { ...base, amount: -1, debit: 2, credit: 3 };
    const r = normalizeRows(p, m);
    expect(r.rows.map((x) => [x.direction, x.amount])).toEqual([["outflow", 4.5], ["inflow", 20]]);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
  });

  it("errors on a non-empty but unparseable debit/credit cell even when the other side is valid", () => {
    const p = parseCsv("Date,Desc,Debit,Credit\n07/01/2026,BAD,N/A,20\n07/02/2026,OK,,5\n");
    const m = { ...base, amount: -1, debit: 2, credit: 3 };
    const r = normalizeRows(p, m);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].description).toBe("OK");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(2);
  });

  it("maps bank categories via categoryValues with direction fallback", () => {
    const p = parseCsv("Date,Desc,Amount,Category\n07/01/2026,SHOP,-1,Food & Drink\n07/02/2026,X,-1,Mystery\n");
    const m = { ...base, category: 3, categoryValues: { "food & drink": "groceries" as const } };
    const r = normalizeRows(p, m);
    expect(r.rows[0].category).toBe("groceries");
    expect(r.rows[1].category).toBe("other");
  });

  it("collects per-row errors without aborting: bad date, bad amount, zero amount, empty description", () => {
    const p = parseCsv("Date,Desc,Amount\nnope,X,5\n07/01/2026,,5\n07/02/2026,Y,zzz\n07/03/2026,Z,0\n07/04/2026,OK,1\n");
    const r = normalizeRows(p, base);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].description).toBe("OK");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
  });

  it("collapses whitespace and caps description at 200 chars", () => {
    const p = parseCsv(`Date,Desc,Amount\n07/01/2026,"A   B${"x".repeat(300)}",1\n`);
    const r = normalizeRows(p, base);
    expect(r.rows[0].description.startsWith("A B")).toBe(true);
    expect(r.rows[0].description.length).toBe(200);
  });
});
