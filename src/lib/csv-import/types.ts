import type { Category } from "@/lib/config/categories";

export interface ParseError {
  line: number;
  message: string;
}

export interface ParsedCsv {
  headers: string[];
  /** Data rows only (header excluded). Short rows are padded with "".
   * `line` is the 1-based source line (header = line 1), preserved across
   * skipped blank/overlong rows so row identity stays exact. */
  rows: Array<{ line: number; cells: string[] }>;
  errors: ParseError[];
}

export type DateFormat = "mdy" | "dmy" | "ymd";
/** For a single signed amount column: which sign means money in. */
export type SignConvention = "positive_inflow" | "positive_outflow";

export interface ColumnMapping {
  /** Column indexes into ParsedCsv.headers; -1 = not chosen yet. */
  date: number;
  description: number;
  /** Single signed amount column, or -1 when using a debit/credit pair. */
  amount: number;
  debit: number;
  credit: number;
  category: number;
  dateFormat: DateFormat;
  signConvention: SignConvention;
  /** Case-folded bank category value -> PFI category. */
  categoryValues: Record<string, Category>;
}

export interface MappingProposal {
  mapping: ColumnMapping;
  detected: {
    date: boolean;
    description: boolean;
    amount: boolean;
    category: boolean;
  };
  confidence: {
    columns: "high" | "low";
    dateFormat: "high" | "low";
    signConvention: "high" | "low";
    categories: "high" | "low";
    overall: "high" | "low";
  };
  /** Plain-language reasons that require the fallback mapping screen. */
  reviewReasons: string[];
  /** Bank category values for which no deterministic mapping was found. */
  unmatchedCategoryValues: string[];
}

/** Structural CSV information safe to send to the optional AI mapper.
 * It intentionally contains no cell values, dates, amounts, descriptions,
 * filenames, account ids, or other raw financial data. */
export interface CsvColumnProfile {
  index: number;
  header: string;
  nonEmptyRatio: number;
  dateLikeRatio: number;
  amountLikeRatio: number;
  distinctRatio: number;
  averageLength: number;
}

export interface CsvMappingSuggestion {
  columns: {
    date: number | null;
    description: number | null;
    amount: number | null;
    debit: number | null;
    credit: number | null;
    category: number | null;
  };
  signConvention: SignConvention | null;
  categoryValues: Record<string, Category>;
}

export interface NormalizedRow {
  /** 1-based source line (header = line 1). Stable row identity across steps. */
  line: number;
  postedDate: string; // ISO yyyy-mm-dd
  amount: number; // > 0, ≤ 2 decimals
  direction: "inflow" | "outflow";
  description: string;
  category: Category;
}

export interface RowError {
  line: number;
  message: string;
}

export interface NormalizeResult {
  rows: NormalizedRow[];
  errors: RowError[];
}

/** Existing-transaction shape (source values) for dedupe/transfer detection. */
export interface ExistingTxn {
  id: string;
  accountId: string;
  postedDate: string;
  amount: number;
  direction: "inflow" | "outflow";
  description: string;
  isTransfer: boolean;
  transferPairId: string | null;
}

export interface DedupeResult {
  fresh: NormalizedRow[];
  duplicates: NormalizedRow[];
}

/** Proposed pair: a batch row (line) + an existing txn on another account. */
export interface TransferPair {
  line: number;
  existingId: string;
}
