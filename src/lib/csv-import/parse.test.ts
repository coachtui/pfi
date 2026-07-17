import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse";

const cells = (r: ReturnType<typeof parseCsv>) => r.rows.map((x) => x.cells);

describe("parseCsv", () => {
  it("parses a simple comma CSV with line numbers", () => {
    const r = parseCsv("Date,Description,Amount\n2026-01-02,COFFEE,-4.50\n");
    expect(r.headers).toEqual(["Date", "Description", "Amount"]);
    expect(r.rows).toEqual([{ line: 2, cells: ["2026-01-02", "COFFEE", "-4.50"] }]);
    expect(r.errors).toEqual([]);
  });

  it("handles quoted fields with embedded delimiters, escaped quotes, and newlines", () => {
    const r = parseCsv('a,b\n"x, y","he said ""hi""\nnext"\n');
    expect(cells(r)).toEqual([['x, y', 'he said "hi"\nnext']]);
  });

  it("strips a BOM and handles CRLF", () => {
    const r = parseCsv("﻿" + "a,b\r\n1,2\r\n");
    expect(r.headers).toEqual(["a", "b"]);
    expect(cells(r)).toEqual([["1", "2"]]);
  });

  it("sniffs semicolon and tab delimiters", () => {
    expect(cells(parseCsv("a;b\n1;2\n"))).toEqual([["1", "2"]]);
    expect(cells(parseCsv("a\tb\n1\t2\n"))).toEqual([["1", "2"]]);
  });

  it("pads short rows and rejects long rows with a line-numbered error", () => {
    const r = parseCsv("a,b,c\n1,2\n1,2,3,4\n");
    expect(r.rows).toEqual([{ line: 2, cells: ["1", "2", ""] }]);
    expect(r.errors).toEqual([{ line: 3, message: "Row has more columns than the header" }]);
  });

  it("skips blank lines but keeps original line numbers", () => {
    expect(parseCsv("a,b\n\n1,2\n\n").rows).toEqual([{ line: 3, cells: ["1", "2"] }]);
    const empty = parseCsv("");
    expect(empty.headers).toEqual([]);
    expect(empty.errors).toEqual([{ line: 1, message: "File is empty" }]);
  });

  it("reports an unclosed quote", () => {
    const r = parseCsv('a,b\n"unclosed,2\n');
    expect(r.errors.some((e) => e.message === "Unclosed quote in file")).toBe(true);
  });
});
