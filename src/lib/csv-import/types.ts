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
