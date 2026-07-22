import type { Category } from "@/lib/config/categories";
import type { AccountType } from "@/lib/financial-engine";
import { parseAmountToken, parseDateToken } from "./normalize";
import type { CsvColumnProfile, DateFormat, MappingProposal, ParsedCsv } from "./types";

const DATE_RX =
  /^(date|posted[ _-]?date|posting[ _-]?date|post[ _-]?date|transaction[ _-]?date|trans[ _-]?date)$/;
const DESC_RX = /(description|payee|memo|merchant|name)/;
const AMOUNT_RX = /^(amount|transaction[ _-]?amount|amount[ _-]?\(usd\))$/;
const DEBIT_RX = /(debit|withdrawal)/;
const CREDIT_RX = /(credit|deposit)/;
const CATEGORY_RX = /category/;

const fold = (h: string) => h.trim().toLowerCase();
const findIdx = (headers: string[], rx: RegExp) => headers.findIndex((h) => rx.test(fold(h)));

function headerRowLooksLikeData(headers: string[]): boolean {
  return headers.some((header) => {
    const value = header.trim();
    return (
      parseAmountToken(value) !== null ||
      (["mdy", "dmy", "ymd"] as const).some((format) => parseDateToken(value, format) !== null)
    );
  });
}

const LIABILITY_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set([
  "credit_card",
  "mortgage",
  "auto_loan",
  "student_loan",
  "personal_loan",
  "other_liability",
]);

const CATEGORY_RULES: ReadonlyArray<{ category: Category; patterns: RegExp[] }> = [
  { category: "income", patterns: [/^(income|salary|payroll|paycheck|wages|bonus)$/i] },
  { category: "housing", patterns: [/\b(housing|rent|mortgage)\b|home (improvement|services)/i] },
  { category: "utilities", patterns: [/\b(utilities?|electric|water|internet|phone|cable)\b/i] },
  { category: "insurance", patterns: [/\binsurance\b/i] },
  { category: "groceries", patterns: [/\b(grocer(?:y|ies)?|supermarket)\b/i] },
  { category: "dining", patterns: [/\b(dining|restaurant|fast food|coffee)\b|food & drink/i] },
  {
    category: "transport",
    patterns: [/\b(transport|gas|fuel|rideshare|taxi|parking|transit)\b|auto & transport/i],
  },
  { category: "health", patterns: [/\b(health|medical|doctor|dental|pharmacy)\b/i] },
  { category: "shopping", patterns: [/\b(shopping|merchandise|retail|clothing)\b/i] },
  {
    category: "discretionary",
    patterns: [/\b(entertainment|recreation|travel|personal care|subscriptions?)\b/i],
  },
  { category: "debt_payment", patterns: [/\b(debt payment|loan payment|credit card payment)\b/i] },
  { category: "savings", patterns: [/\b(savings|investment contribution)\b/i] },
  { category: "other", patterns: [/\b(other|uncategorized|transfer)\b|fees? & charges?/i] },
];

export function inferCategoryValue(raw: string): Category | null {
  const value = raw.trim();
  if (value === "") return null;
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(value))) return rule.category;
  }
  return null;
}

export function distinctCategoryValues(
  parsed: ParsedCsv,
  categoryIndex: number,
  limit = 50,
): string[] {
  if (categoryIndex < 0 || headerRowLooksLikeData(parsed.headers)) return [];
  const values = new Set<string>();
  for (const { cells } of parsed.rows) {
    const value = (cells[categoryIndex] ?? "").trim().toLowerCase();
    if (value !== "") values.add(value);
    if (values.size >= limit) break;
  }
  return [...values].sort();
}

function inferDateFormatDetailed(samples: string[]): { format: DateFormat; confident: boolean } {
  for (const raw of samples) {
    const parts = raw.trim().split(/[/\-.]/);
    if (parts.length !== 3) continue;
    if (parts[0].length === 4) return { format: "ymd", confident: true };
    const first = Number(parts[0]);
    const second = Number(parts[1]);
    if (first > 12) return { format: "dmy", confident: true };
    if (second > 12) return { format: "mdy", confident: true };
  }
  return { format: "mdy", confident: false };
}

/** Infer how ambiguous slash/dash dates should be read from sample values. */
export function inferDateFormat(samples: string[]): DateFormat {
  return inferDateFormatDetailed(samples).format;
}

function inferSignConvention(
  parsed: ParsedCsv,
  amountIndex: number,
  accountType?: AccountType,
): { value: "positive_inflow" | "positive_outflow"; confident: boolean } {
  if (amountIndex < 0) return { value: "positive_inflow", confident: true };
  const header = fold(parsed.headers[amountIndex] ?? "");
  if (/(debit|withdrawal|charge)/.test(header))
    return { value: "positive_outflow", confident: true };
  if (/(credit|deposit)/.test(header)) return { value: "positive_inflow", confident: true };
  if (accountType) {
    return {
      value: LIABILITY_ACCOUNT_TYPES.has(accountType) ? "positive_outflow" : "positive_inflow",
      confident: true,
    };
  }
  return { value: "positive_inflow", confident: false };
}

/** Build privacy-preserving profiles for the optional server-side AI fallback. */
export function profileCsvColumns(parsed: ParsedCsv): CsvColumnProfile[] {
  const sample = parsed.rows.slice(0, 200);
  const unsafeHeaders = headerRowLooksLikeData(parsed.headers);
  return parsed.headers.map((header, index) => {
    const values = sample.map((row) => (row.cells[index] ?? "").trim()).filter(Boolean);
    const denominator = Math.max(sample.length, 1);
    const dateLike = values.filter((value) =>
      (["mdy", "dmy", "ymd"] as const).some((format) => parseDateToken(value, format) !== null),
    ).length;
    const amountLike = values.filter((value) => parseAmountToken(value) !== null).length;
    return {
      index,
      header: unsafeHeaders ? `Column ${index + 1}` : header.slice(0, 100).replace(/\d{3,}/g, "#"),
      nonEmptyRatio: values.length / denominator,
      dateLikeRatio: values.length === 0 ? 0 : dateLike / values.length,
      amountLikeRatio: values.length === 0 ? 0 : amountLike / values.length,
      distinctRatio: values.length === 0 ? 0 : new Set(values).size / values.length,
      averageLength:
        values.length === 0
          ? 0
          : values.reduce((sum, value) => sum + value.length, 0) / values.length,
    };
  });
}

/** Propose a column mapping from common bank header names + sample values.
 * Proposals only — the user confirms every field in the mapping step. */
export function proposeMapping(parsed: ParsedCsv, accountType?: AccountType): MappingProposal {
  const { headers, rows } = parsed;
  const date = findIdx(headers, DATE_RX);
  const description = findIdx(headers, DESC_RX);
  const amount = findIdx(headers, AMOUNT_RX);
  // Only propose a debit/credit pair when no single amount column exists.
  const debit = amount === -1 ? findIdx(headers, DEBIT_RX) : -1;
  const credit = amount === -1 ? findIdx(headers, CREDIT_RX) : -1;
  const category = findIdx(headers, CATEGORY_RX);

  const dateSamples = date === -1 ? [] : rows.slice(0, 50).map((r) => r.cells[date] ?? "");
  const dateInference = inferDateFormatDetailed(dateSamples);
  const signInference = inferSignConvention(parsed, amount, accountType);
  const categoryValues = distinctCategoryValues(parsed, category);
  const mappedCategories: Record<string, Category> = {};
  const unmatchedCategoryValues: string[] = [];
  for (const value of categoryValues) {
    const mapped = inferCategoryValue(value);
    if (mapped) mappedCategories[value] = mapped;
    else unmatchedCategoryValues.push(value);
  }
  const columnsHigh =
    date !== -1 && description !== -1 && (amount !== -1 || (debit !== -1 && credit !== -1));
  const dateHigh = date !== -1 && dateInference.confident;
  const signHigh = amount === -1 || signInference.confident;
  const categoriesHigh = category === -1 || unmatchedCategoryValues.length === 0;
  const reviewReasons: string[] = [];
  if (!columnsHigh) reviewReasons.push("PFI could not identify every required column.");
  if (date !== -1 && !dateHigh) reviewReasons.push("The date order is ambiguous.");
  if (amount !== -1 && !signHigh)
    reviewReasons.push("PFI cannot tell whether positive amounts mean money received or spent.");
  return {
    mapping: {
      date,
      description,
      amount,
      debit,
      credit,
      category,
      dateFormat: dateInference.format,
      signConvention: signInference.value,
      categoryValues: mappedCategories,
    },
    detected: {
      date: date !== -1,
      description: description !== -1,
      amount: amount !== -1 || (debit !== -1 && credit !== -1),
      category: category !== -1,
    },
    confidence: {
      columns: columnsHigh ? "high" : "low",
      dateFormat: dateHigh ? "high" : "low",
      signConvention: signHigh ? "high" : "low",
      categories: categoriesHigh ? "high" : "low",
      overall: columnsHigh && dateHigh && signHigh ? "high" : "low",
    },
    reviewReasons,
    unmatchedCategoryValues,
  };
}
