import type { Category } from "@/lib/config/categories";
import type { ColumnMapping, DateFormat, NormalizeResult, NormalizedRow, ParsedCsv, RowError } from "./types";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function parseDateToken(raw: string, format: DateFormat): string | null {
  const parts = raw.trim().split(/[/\-.]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let y: number, m: number, d: number;
  if (format === "ymd") [y, m, d] = nums;
  else if (format === "dmy") [d, m, y] = nums;
  else [m, d, y] = nums;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  // Reject impossible dates (e.g. Feb 30) via UTC round-trip.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Signed numeric amount from bank-export syntax; null when unparseable. */
export function parseAmountToken(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { negative = true; s = paren[1]; }
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[$€£\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return negative ? -n : n;
}

const cleanDescription = (raw: string) => raw.trim().replace(/\s+/g, " ").slice(0, 200);

/** Apply a confirmed mapping to parsed rows. Per-row errors are collected,
 * never thrown, and errored rows are excluded from the result — the preview
 * lists them with reasons (no silent drops). */
export function normalizeRows(parsed: ParsedCsv, mapping: ColumnMapping): NormalizeResult {
  const rows: NormalizedRow[] = [];
  const errors: RowError[] = [];
  const cell = (cells: string[], idx: number) => (idx >= 0 && idx < cells.length ? cells[idx] : "");
  const today = new Date().toISOString().slice(0, 10);

  for (const { line, cells } of parsed.rows) {
    const postedDate = parseDateToken(cell(cells, mapping.date), mapping.dateFormat);
    if (!postedDate) {
      errors.push({ line, message: `Unrecognized date "${cell(cells, mapping.date)}"` });
      continue;
    }
    if (postedDate > today) {
      errors.push({ line, message: `Date "${postedDate}" is in the future` });
      continue;
    }
    const description = cleanDescription(cell(cells, mapping.description));
    if (description === "") {
      errors.push({ line, message: "Description is empty" });
      continue;
    }

    let amount: number, direction: "inflow" | "outflow";
    if (mapping.amount !== -1) {
      const signed = parseAmountToken(cell(cells, mapping.amount));
      if (signed === null) {
        errors.push({ line, message: `Unrecognized amount "${cell(cells, mapping.amount)}"` });
        continue;
      }
      if (signed === 0) { errors.push({ line, message: "Amount is zero" }); continue; }
      const positiveIn = mapping.signConvention === "positive_inflow";
      direction = signed > 0 === positiveIn ? "inflow" : "outflow";
      amount = Math.abs(signed);
    } else {
      const debitRaw = cell(cells, mapping.debit).trim();
      const creditRaw = cell(cells, mapping.credit).trim();
      if (debitRaw !== "" && parseAmountToken(debitRaw) === null) {
        errors.push({ line, message: `Unrecognized debit "${debitRaw}"` });
        continue;
      }
      if (creditRaw !== "" && parseAmountToken(creditRaw) === null) {
        errors.push({ line, message: `Unrecognized credit "${creditRaw}"` });
        continue;
      }
      const debit = debitRaw === "" ? null : parseAmountToken(debitRaw);
      const credit = creditRaw === "" ? null : parseAmountToken(creditRaw);
      const hasDebit = debit !== null && debit !== 0;
      const hasCredit = credit !== null && credit !== 0;
      if (hasDebit === hasCredit) {
        errors.push({ line, message: "Expected exactly one of debit or credit" });
        continue;
      }
      direction = hasDebit ? "outflow" : "inflow";
      amount = Math.abs(hasDebit ? debit! : credit!);
    }

    if (amount > 10_000_000) {
      errors.push({ line, message: `Amount ${amount} exceeds the maximum` });
      continue;
    }

    let category: Category = direction === "inflow" ? "income" : "other";
    if (mapping.category !== -1) {
      const mapped = mapping.categoryValues[cell(cells, mapping.category).trim().toLowerCase()];
      if (mapped) category = mapped;
    }

    rows.push({ line, postedDate, amount, direction, description, category });
  }
  return { rows, errors };
}
