import type { DateFormat, MappingProposal, ParsedCsv } from "./types";

const DATE_RX = /^(date|posted[ _-]?date|posting[ _-]?date|post[ _-]?date|transaction[ _-]?date|trans[ _-]?date)$/;
const DESC_RX = /(description|payee|memo|merchant|name)/;
const AMOUNT_RX = /^(amount|transaction[ _-]?amount|amount[ _-]?\(usd\))$/;
const DEBIT_RX = /(debit|withdrawal)/;
const CREDIT_RX = /(credit|deposit)/;
const CATEGORY_RX = /category/;

const fold = (h: string) => h.trim().toLowerCase();
const findIdx = (headers: string[], rx: RegExp) => headers.findIndex((h) => rx.test(fold(h)));

/** Infer how ambiguous slash/dash dates should be read from sample values. */
export function inferDateFormat(samples: string[]): DateFormat {
  for (const raw of samples) {
    const parts = raw.trim().split(/[/\-.]/);
    if (parts.length !== 3) continue;
    if (parts[0].length === 4) return "ymd";
    const first = Number(parts[0]);
    const second = Number(parts[1]);
    if (first > 12) return "dmy";
    if (second > 12) return "mdy";
  }
  return "mdy";
}

/** Propose a column mapping from common bank header names + sample values.
 * Proposals only — the user confirms every field in the mapping step. */
export function proposeMapping(parsed: ParsedCsv): MappingProposal {
  const { headers, rows } = parsed;
  const date = findIdx(headers, DATE_RX);
  const description = findIdx(headers, DESC_RX);
  const amount = findIdx(headers, AMOUNT_RX);
  // Only propose a debit/credit pair when no single amount column exists.
  const debit = amount === -1 ? findIdx(headers, DEBIT_RX) : -1;
  const credit = amount === -1 ? findIdx(headers, CREDIT_RX) : -1;
  const category = findIdx(headers, CATEGORY_RX);

  const dateSamples = date === -1 ? [] : rows.slice(0, 25).map((r) => r.cells[date] ?? "");
  return {
    mapping: {
      date, description, amount, debit, credit, category,
      dateFormat: inferDateFormat(dateSamples),
      signConvention: "positive_inflow",
      categoryValues: {},
    },
    detected: {
      date: date !== -1,
      description: description !== -1,
      amount: amount !== -1 || (debit !== -1 && credit !== -1),
      category: category !== -1,
    },
  };
}
