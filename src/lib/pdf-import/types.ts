import type { Category } from "@/lib/config/categories";
import type { NormalizedRow } from "@/lib/csv-import/types";

export const PDF_IMPORT_BUCKET = "statement-pdfs";
export const PDF_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_IMPORT_MAX_PAGES = 24;
export const PDF_IMPORT_PARSER_VERSION = "pdf-generic-v1";

export type PdfAccountType = "checking" | "savings" | "credit_card";
export type ExtractionMethod = "native_text" | "layout_text" | "institution_adapter" | "ocr" | "ai_assisted";
export type ConfidenceLevel = "high" | "medium" | "low";
export type ReconciliationStatus =
  | "reconciled"
  | "reconciled_within_tolerance"
  | "not_enough_information"
  | "does_not_reconcile";

export interface PdfValidationResult {
  ok: boolean;
  reason?: string;
  pageCount?: number;
  encrypted?: boolean;
}

export interface ExtractedText {
  text: string;
  method: ExtractionMethod;
  pageCount: number | null;
  scanned: boolean;
}

export interface StatementMetadata {
  institution: string | null;
  accountName: string | null;
  accountType: PdfAccountType | null;
  maskedAccountNumber: string | null;
  statementStartDate: string | null;
  statementEndDate: string | null;
  beginningBalance: number | null;
  endingBalance: number | null;
  availableBalance: number | null;
  creditLimit: number | null;
  minimumPayment: number | null;
  paymentDueDate: string | null;
}

export interface FieldConfidence {
  dates?: ConfidenceLevel;
  amounts?: ConfidenceLevel;
  direction?: ConfidenceLevel;
  endingBalance?: ConfidenceLevel;
  accountIdentification?: ConfidenceLevel;
}

export interface ExtractedTransaction extends NormalizedRow {
  transactionDate: string | null;
  referenceNumber: string | null;
  sourcePage: number | null;
  confidence: ConfidenceLevel;
  fieldConfidence: FieldConfidence;
  issues: string[];
}

export interface ParsedStatement {
  metadata: StatementMetadata;
  transactions: ExtractedTransaction[];
  extractionMethod: ExtractionMethod;
  confidence: ConfidenceLevel;
  fieldConfidence: FieldConfidence;
  reconciliation: ReconciliationResult;
  issues: string[];
  unsupportedReason: string | null;
  rawTextExcerpt: string;
}

export interface ReconciliationResult {
  status: ReconciliationStatus;
  difference: number | null;
  tolerance: number;
  equation: string | null;
}

export interface ParserAdapter {
  id: string;
  supports(text: string): boolean;
  parse(text: string): ParsedStatement;
}

export type ReviewTransaction = ExtractedTransaction & {
  stagedId: string;
  excluded: boolean;
  duplicateOfTransactionId: string | null;
};

export interface PdfReviewData {
  importId: string;
  status: string;
  originalFilename: string;
  storagePath: string;
  detectedInstitution: string | null;
  detectedAccountType: PdfAccountType | null;
  statementStartDate: string | null;
  statementEndDate: string | null;
  extractionMethod: ExtractionMethod | null;
  confidence: ConfidenceLevel | null;
  failureReason: string | null;
  unsupportedReason: string | null;
  validationResults: string[];
  reconciliation: ReconciliationResult | null;
  metadata: StatementMetadata;
  fieldConfidence: FieldConfidence;
  transactions: ReviewTransaction[];
  suggestedAccountId: string | null;
}

export function categoryForDirection(direction: "inflow" | "outflow"): Category {
  return direction === "inflow" ? "income" : "other";
}
