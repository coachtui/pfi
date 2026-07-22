import type { Category } from "@/lib/config/categories";
import { categoryForDirection, type ConfidenceLevel, type FieldConfidence, type ReviewTransaction } from "./types";

/** Shape of a `staged_transactions` DB row as read by `readPdfReview`. */
export interface StagedTransactionRow {
  id: string;
  posted_date: string;
  transaction_date: string | null;
  amount: number | string;
  direction: "inflow" | "outflow";
  description: string;
  category: Category | null;
  reference_number: string | null;
  source_page: number | null;
  confidence: ConfidenceLevel;
  field_confidence: FieldConfidence | null;
  issues: unknown;
  excluded: boolean;
  duplicate_of_transaction_id: string | null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Map staged DB rows to review-transaction view models, assigning each a
 * unique 1-based `line` (first row = 2, matching the CSV convention where the
 * notional header is line 1). Unique lines are required: `commitImportedTransactions`
 * keys its exact-dedupe whitelist on `line`, so a shared constant leaks the
 * "import duplicate" decision across every row.
 */
export function mapStagedRowsToReviewTransactions(rows: StagedTransactionRow[]): ReviewTransaction[] {
  return rows.map((r, idx) => ({
    stagedId: r.id,
    line: idx + 2,
    postedDate: r.posted_date,
    transactionDate: r.transaction_date,
    amount: Number(r.amount),
    direction: r.direction,
    description: r.description,
    category: r.category ?? categoryForDirection(r.direction),
    referenceNumber: r.reference_number,
    sourcePage: r.source_page,
    confidence: r.confidence,
    fieldConfidence: r.field_confidence ?? {},
    issues: toStringArray(r.issues),
    excluded: r.excluded,
    duplicateOfTransactionId: r.duplicate_of_transaction_id,
  }));
}
