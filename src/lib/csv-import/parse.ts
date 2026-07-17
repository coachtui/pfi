import type { ParsedCsv, ParseError } from "./types";

const DELIMITERS = [",", ";", "\t"] as const;

function sniffDelimiter(firstLine: string): string {
  let best = ",",
    bestCount = -1;
  for (const d of DELIMITERS) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** RFC-4180-ish: quoted fields (embedded delimiters/quotes/newlines), BOM,
 * CRLF, delimiter sniffing, blank-line skipping, ragged-row tolerance. */
export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^﻿/, "");
  if (src.trim() === "") {
    return {
      headers: [],
      rows: [],
      errors: [{ line: 1, message: "File is empty" }],
    };
  }
  const delimiter = sniffDelimiter(
    src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n"))
  );

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delimiter) {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else field += c;
  }
  const errors: ParseError[] = [];
  if (inQuotes)
    errors.push({ line: records.length + 1, message: "Unclosed quote in file" });
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Drop entirely-blank records but keep original line numbers.
  const numbered = records
    .map((cells, idx) => ({ cells, line: idx + 1 }))
    .filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (numbered.length === 0) {
    return {
      headers: [],
      rows: [],
      errors: [{ line: 1, message: "File is empty" }],
    };
  }

  const headers = numbered[0].cells.map((h) => h.trim());
  const rows: ParsedCsv["rows"] = [];
  for (const { cells, line } of numbered.slice(1)) {
    if (cells.length > headers.length) {
      errors.push({
        line,
        message: "Row has more columns than the header",
      });
      continue;
    }
    rows.push({
      line,
      cells: [
        ...cells,
        ...Array(headers.length - cells.length).fill(""),
      ],
    });
  }
  return { headers, rows, errors };
}
