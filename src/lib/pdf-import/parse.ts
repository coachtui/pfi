import { parseAmountToken, parseDateToken } from "@/lib/csv-import/normalize";
import { differenceMoney, toCents } from "./money";
import {
  PDF_IMPORT_PARSER_VERSION,
  categoryForDirection,
  type ConfidenceLevel,
  type ExtractedTransaction,
  type FieldConfidence,
  type ParsedStatement,
  type PdfAccountType,
  type ReconciliationResult,
  type StatementMetadata,
} from "./types";

const blankMetadata = (): StatementMetadata => ({
  institution: null,
  accountName: null,
  accountType: null,
  maskedAccountNumber: null,
  statementStartDate: null,
  statementEndDate: null,
  beginningBalance: null,
  endingBalance: null,
  availableBalance: null,
  creditLimit: null,
  minimumPayment: null,
  paymentDueDate: null,
});

const lower = (s: string) => s.toLowerCase();

function parseLooseDate(raw: string): string | null {
  const cleaned = raw.trim().replace(/,/g, "");
  return parseDateToken(cleaned, "mdy") ?? parseDateToken(cleaned, "ymd") ?? parseDateToken(cleaned, "dmy");
}

function moneyAfter(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*(\\(?[-+$€£\\d,]+(?:\\.\\d{1,2})?\\)?)`, "i");
    const m = re.exec(text);
    if (m) {
      const n = parseAmountToken(m[1]);
      if (n !== null) return Math.abs(n);
    }
  }
  return null;
}

function dateAfter(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`, "i");
    const m = re.exec(text);
    if (m) return parseLooseDate(m[1]);
  }
  return null;
}

function detectInstitution(lines: string[]): string | null {
  const explicit = lines.find((l) => /^institution\s*:/i.test(l));
  if (explicit) return explicit.replace(/^institution\s*:\s*/i, "").trim().slice(0, 80) || null;
  const first = lines.find((l) => /bank|credit union|card|financial|fcu|chase|wells|citi|capital one|amex/i.test(l));
  return first?.trim().slice(0, 80) ?? null;
}

export function classifyStatement(text: string): { accountType: PdfAccountType | null; unsupportedReason: string | null } {
  const t = lower(text);
  if (/\b(brokerage|investment|retirement|ira|401k|securities|tax lot|option contract|holdings)\b/.test(t)) {
    return { accountType: null, unsupportedReason: "Brokerage, investment, retirement, and tax-lot statements are not supported in this phase." };
  }
  if (/\b(credit card|minimum payment|payment due date|credit limit|new balance)\b/.test(t)) {
    return { accountType: "credit_card", unsupportedReason: null };
  }
  if (/\bsavings\b/.test(t)) return { accountType: "savings", unsupportedReason: null };
  if (/\b(checking|debit card|deposits?|withdrawals?)\b/.test(t)) return { accountType: "checking", unsupportedReason: null };
  return { accountType: null, unsupportedReason: "This does not look like a supported checking, savings, or credit-card statement." };
}

function parseMetadata(text: string, accountType: PdfAccountType | null): StatementMetadata {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const period =
    /statement\s+period\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s*(?:-|to|through|–)\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(text);
  const accountNumber =
    /(?:account|card)\s*(?:number|no\.?)?\s*[:#\-]?\s*(?:x{2,}|\*{2,}|ending\s+in)?\s*([*\dxX-]{2,20})/i.exec(text);

  return {
    ...blankMetadata(),
    institution: detectInstitution(lines),
    accountName: lines.find((l) => /\b(checking|savings|credit card)\b/i.test(l))?.slice(0, 80) ?? null,
    accountType,
    maskedAccountNumber: accountNumber?.[1]?.replace(/[^\d*xX-]/g, "").slice(-12) ?? null,
    statementStartDate: period ? parseLooseDate(period[1]) : dateAfter(text, ["statement start date", "opening date"]),
    statementEndDate: period ? parseLooseDate(period[2]) : dateAfter(text, ["statement end date", "closing date", "statement date"]),
    beginningBalance: moneyAfter(text, ["beginning balance", "previous balance", "opening balance"]),
    endingBalance: moneyAfter(text, ["ending balance", "new balance", "closing balance"]),
    availableBalance: moneyAfter(text, ["available balance"]),
    creditLimit: moneyAfter(text, ["credit limit"]),
    minimumPayment: moneyAfter(text, ["minimum payment", "minimum amount due"]),
    paymentDueDate: dateAfter(text, ["payment due date", "due date"]),
  };
}

function directionFromLine(line: string, amount: number, accountType: PdfAccountType): "inflow" | "outflow" {
  const l = lower(line);
  if (/\b(payment|credit|refund|deposit|interest paid|transfer from)\b/.test(l)) return "inflow";
  if (/\b(debit|withdrawal|purchase|fee|interest charged|check|card purchase|transfer to)\b/.test(l)) return "outflow";
  return amount < 0 ? "outflow" : accountType === "credit_card" ? "outflow" : "inflow";
}

function parseTransactions(text: string, accountType: PdfAccountType): ExtractedTransaction[] {
  const rows: ExtractedTransaction[] = [];
  const dateStartRe = /^\s*(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\s+/;
  const moneyRe = /(\(?[-+$€£]?\d[\d,]*(?:\.\d{1,2})?\)?)/g;
  const periodYear = /statement\s+period[\s\S]*?((?:19|20)\d{2})/i.exec(text)?.[1];
  const year = periodYear ?? /(?:19|20)\d{2}/.exec(text)?.[0] ?? new Date().getFullYear().toString();
  let lineNo = 2;
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (/balance|total|summary|minimum payment|credit limit/i.test(line)) continue;
    const dateMatch = dateStartRe.exec(line);
    if (!dateMatch) continue;
    const moneyMatches = [...line.matchAll(moneyRe)];
    const amountMatch = moneyMatches.at(-1);
    if (!amountMatch) continue;
    const posted = parseLooseDate(dateMatch[1].includes("/") && dateMatch[1].split("/").length === 2 ? `${dateMatch[1]}/${year}` : dateMatch[1]);
    const afterDate = line.slice(dateMatch[0].length);
    const secondDate = dateStartRe.exec(afterDate);
    const txnDate = secondDate
      ? parseLooseDate(secondDate[1].includes("/") && secondDate[1].split("/").length === 2 ? `${secondDate[1]}/${year}` : secondDate[1])
      : null;
    const descriptionStart = secondDate ? secondDate[0].length : 0;
    const description = afterDate
      .slice(descriptionStart, amountMatch.index! - dateMatch[0].length)
      .replace(/\b(debit|credit|withdrawal|deposit|purchase|payment)\b\s*$/i, "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 200);
    const signed = parseAmountToken(amountMatch[1]);
    if (!posted || signed === null || signed === 0) continue;
    const hint = /\b(debit|credit|withdrawal|deposit|purchase|payment)\b/i.exec(line)?.[1]?.toLowerCase();
    const direction = hint
      ? hint === "credit" || hint === "deposit" || hint === "payment" ? "inflow" : "outflow"
      : directionFromLine(line, signed, accountType);
    const amount = Math.abs(signed);
    rows.push({
      line: lineNo++,
      postedDate: posted,
      transactionDate: txnDate,
      amount,
      direction,
      description,
      category: categoryForDirection(direction),
      referenceNumber: /\b(?:ref|reference|check)\s*#?\s*([a-z0-9-]+)/i.exec(line)?.[1] ?? null,
      sourcePage: null,
      confidence: hint ? "high" : "medium",
      fieldConfidence: { dates: "medium", amounts: "high", direction: hint ? "high" : "medium" },
      issues: hint ? [] : ["Debit or credit direction inferred from statement wording."],
    });
  }
  return rows;
}

export function reconcileStatement(metadata: StatementMetadata, transactions: ExtractedTransaction[]): ReconciliationResult {
  const tolerance = 0.01;
  if (metadata.beginningBalance === null || metadata.endingBalance === null) {
    return { status: "not_enough_information", difference: null, tolerance, equation: null };
  }
  const begin = toCents(metadata.beginningBalance)!;
  const end = toCents(metadata.endingBalance)!;
  const inflow = transactions.filter((t) => t.direction === "inflow").reduce((s, t) => s + toCents(t.amount)!, 0);
  const outflow = transactions.filter((t) => t.direction === "outflow").reduce((s, t) => s + toCents(t.amount)!, 0);
  const expected = metadata.accountType === "credit_card"
    ? begin + outflow - inflow
    : begin + inflow - outflow;
  const diff = (expected - end) / 100;
  if (diff === 0) {
    return {
      status: "reconciled",
      difference: 0,
      tolerance,
      equation: metadata.accountType === "credit_card"
        ? "previous balance + purchases/fees/interest - payments/credits = new balance"
        : "beginning balance + credits - debits/fees = ending balance",
    };
  }
  return {
    status: Math.abs(diff) <= tolerance ? "reconciled_within_tolerance" : "does_not_reconcile",
    difference: differenceMoney(expected / 100, end / 100),
    tolerance,
    equation: metadata.accountType === "credit_card"
      ? "previous balance + purchases/fees/interest - payments/credits = new balance"
      : "beginning balance + credits - debits/fees = ending balance",
  };
}

function confidence(metadata: StatementMetadata, txns: ExtractedTransaction[], recon: ReconciliationResult): ConfidenceLevel {
  if (txns.length === 0) return "low";
  if (metadata.accountType && metadata.statementEndDate && metadata.endingBalance !== null && recon.status === "reconciled") return "high";
  if (metadata.accountType && metadata.statementEndDate && metadata.endingBalance !== null) return "medium";
  return "low";
}

export function parseGenericStatement(text: string): ParsedStatement {
  const cls = classifyStatement(text);
  if (cls.unsupportedReason || !cls.accountType) {
    return {
      metadata: blankMetadata(),
      transactions: [],
      extractionMethod: "native_text",
      confidence: "low",
      fieldConfidence: {},
      reconciliation: { status: "not_enough_information", difference: null, tolerance: 0.01, equation: null },
      issues: [],
      unsupportedReason: cls.unsupportedReason,
      rawTextExcerpt: text.slice(0, 4000),
    };
  }
  const metadata = parseMetadata(text, cls.accountType);
  const transactions = parseTransactions(text, cls.accountType);
  const reconciliation = reconcileStatement(metadata, transactions);
  const fieldConfidence: FieldConfidence = {
    dates: metadata.statementStartDate && metadata.statementEndDate ? "high" : "low",
    amounts: transactions.length > 0 ? "high" : "low",
    direction: transactions.some((t) => t.issues.length) ? "medium" : "high",
    endingBalance: metadata.endingBalance !== null ? "high" : "low",
    accountIdentification: metadata.maskedAccountNumber || metadata.institution ? "medium" : "low",
  };
  return {
    metadata,
    transactions,
    extractionMethod: "native_text",
    confidence: confidence(metadata, transactions, reconciliation),
    fieldConfidence,
    reconciliation,
    issues: transactions.length === 0 ? ["No transaction table rows were detected."] : [],
    unsupportedReason: null,
    rawTextExcerpt: text.slice(0, 4000),
  };
}

export const parserMetadata = { parserVersion: PDF_IMPORT_PARSER_VERSION };
