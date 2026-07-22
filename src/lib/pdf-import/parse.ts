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

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const numericDatePattern = String.raw`\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}`;
const monthDatePattern = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}`;
const shortMonthDatePattern = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}`;
const statementDatePattern = `(?:${numericDatePattern}|${monthDatePattern})`;
const decimalMoneyRe = /(\(?[-+$€£]?\s*\d[\d,]*\.\d{2}\)?)/g;

function parseLooseDate(raw: string): string | null {
  const cleaned = raw.trim().replace(/,/g, "");
  const named = /^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/i.exec(cleaned);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    const day = Number(named[2]);
    const year = Number(named[3]);
    if (month && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  return parseDateToken(cleaned, "mdy") ?? parseDateToken(cleaned, "ymd") ?? parseDateToken(cleaned, "dmy");
}

function statementPeriod(text: string): [string | null, string | null] {
  const match = new RegExp(`(${statementDatePattern})\\s*(?:-|–|to|thru|through)\\s*(${statementDatePattern})`, "i").exec(text);
  return match ? [parseLooseDate(match[1]), parseLooseDate(match[2])] : [null, null];
}

function documentDate(text: string): string | null {
  const match = new RegExp(`\\b(${statementDatePattern})\\b`, "i").exec(text);
  return match ? parseLooseDate(match[1]) : null;
}

function parseContextualDate(raw: string, contextDate: string | null): string | null {
  if (/\d{4}/.test(raw) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(raw)) {
    return parseLooseDate(raw);
  }
  const contextYear = Number(contextDate?.slice(0, 4) ?? new Date().getFullYear());
  const withYear = /^[a-z]/i.test(raw) ? `${raw} ${contextYear}` : `${raw}/${contextYear}`;
  let parsed = parseLooseDate(withYear);
  if (!parsed || !contextDate) return parsed;

  // Activity printed in early January may include transactions from December.
  // Treat a short date more than 31 days after the print date as the prior year.
  const candidateTime = Date.parse(`${parsed}T00:00:00Z`);
  const contextTime = Date.parse(`${contextDate}T00:00:00Z`);
  if (candidateTime - contextTime > 31 * 24 * 60 * 60 * 1000) {
    const priorYear = contextYear - 1;
    parsed = parseLooseDate(/^[a-z]/i.test(raw) ? `${raw} ${priorYear}` : `${raw}/${priorYear}`);
  }
  return parsed;
}

function columnarSummaryBalances(text: string): { beginningBalance: number | null; endingBalance: number | null } {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index];
    if (!/beginning balance/i.test(header) || !/ending balance/i.test(header)) continue;
    const values = [...lines[index + 1].matchAll(decimalMoneyRe)]
      .map((match) => parseAmountToken(match[1]))
      .filter((value): value is number => value !== null);
    if (values.length < 2) continue;
    return {
      beginningBalance: Math.abs(values[0]),
      endingBalance: Math.abs(values[/ytd dividends?/i.test(header) && values.length >= 3 ? values.length - 2 : values.length - 1]),
    };
  }
  return { beginningBalance: null, endingBalance: null };
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
  if (/\bcapital one\b/.test(t) && /\bpending transactions\b/.test(t)) {
    return {
      accountType: null,
      unsupportedReason: "Pending transactions are not final and cannot be imported. Upload posted activity or a monthly statement instead.",
    };
  }
  if (
    /\bcapital one\b/.test(t)
    && /\bposted transactions since your last statement\b/.test(t)
    && /\bdate\s+description\s+category\s+card\s+amount\b/.test(t.replace(/\n+/g, " "))
  ) {
    return { accountType: "credit_card", unsupportedReason: null };
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
  const period = statementPeriod(text);
  const summary = columnarSummaryBalances(text);
  const accountNumber =
    /(?:account|card)\s*(?:number|no\.?)?\s*[:#\-]?\s*(?:x{2,}|\*{2,}|ending\s+in)?\s*([.*\dxX-]{2,20})/i.exec(text);

  return {
    ...blankMetadata(),
    institution: detectInstitution(lines),
    accountName: lines.find((l) => /\b(checking|savings|credit card)\b/i.test(l))?.slice(0, 80) ?? null,
    accountType,
    maskedAccountNumber: accountNumber?.[1]?.replace(/[^\d*xX-]/g, "").slice(-12) ?? null,
    statementStartDate: period[0] ?? dateAfter(text, ["statement start date", "opening date"]),
    statementEndDate: period[1] ?? dateAfter(text, ["statement end date", "closing date", "statement date"]),
    beginningBalance: moneyAfter(text, ["beginning balance", "previous balance", "opening balance"]) ?? summary.beginningBalance,
    endingBalance: moneyAfter(text, ["ending balance", "new balance", "closing balance"]) ?? summary.endingBalance,
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
  if (amount < 0) return accountType === "credit_card" ? "inflow" : "outflow";
  return accountType === "credit_card" ? "outflow" : "inflow";
}

function parseColumnarTransactions(
  text: string,
  accountType: PdfAccountType,
  metadata: StatementMetadata,
): ExtractedTransaction[] | null {
  if (!/transaction description\s+deposit\s+withdrawal\s+balance/i.test(text.replace(/\n+/g, " "))) return null;

  const rows: ExtractedTransaction[] = [];
  const dateStartRe = /^\s*(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2})\s+/;
  const year = metadata.statementEndDate?.slice(0, 4) ?? new Date().getFullYear().toString();
  let priorBalance = metadata.beginningBalance === null ? null : toCents(metadata.beginningBalance);
  let pageNumber: number | null = null;
  let lineNo = 2;

  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    const page = /^--- Page (\d+) ---$/.exec(line);
    if (page) {
      pageNumber = Number(page[1]);
      continue;
    }
    const firstDate = dateStartRe.exec(line);
    if (!firstDate) continue;
    const moneyMatches = [...line.matchAll(decimalMoneyRe)];
    if (/beginning balance/i.test(line) && moneyMatches.length === 1) {
      const opening = parseAmountToken(moneyMatches[0][1]);
      if (opening !== null) priorBalance = toCents(Math.abs(opening));
      continue;
    }
    if (moneyMatches.length < 2) continue;

    const afterFirstDate = line.slice(firstDate[0].length);
    const secondDate = dateStartRe.exec(afterFirstDate);
    const dateText = firstDate[1].includes("/") && firstDate[1].split("/").length === 2 ? `${firstDate[1]}/${year}` : firstDate[1];
    const postedDate = parseLooseDate(dateText);
    const transactionDate = secondDate
      ? parseLooseDate(secondDate[1].includes("/") && secondDate[1].split("/").length === 2 ? `${secondDate[1]}/${year}` : secondDate[1])
      : null;
    const amountMatch = moneyMatches.at(-2)!;
    const balanceMatch = moneyMatches.at(-1)!;
    const parsedAmount = parseAmountToken(amountMatch[1]);
    const parsedBalance = parseAmountToken(balanceMatch[1]);
    if (!postedDate || parsedAmount === null || parsedBalance === null || parsedAmount === 0) continue;

    const amount = Math.abs(parsedAmount);
    const amountCents = toCents(amount)!;
    const balanceCents = toCents(Math.abs(parsedBalance))!;
    const delta = priorBalance === null ? null : balanceCents - priorBalance;
    const balanceMatched = delta !== null && Math.abs(delta) === amountCents;
    const direction = balanceMatched
      ? delta! > 0 ? "inflow" : "outflow"
      : parsedAmount < 0 ? "outflow" : directionFromLine(line, parsedAmount, accountType);
    const descriptionStart = firstDate[0].length + (secondDate?.[0].length ?? 0);
    const description = line
      .slice(descriptionStart, amountMatch.index)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 200);
    priorBalance = balanceCents;
    rows.push({
      line: lineNo++,
      postedDate,
      transactionDate,
      amount,
      direction,
      description,
      category: categoryForDirection(direction),
      referenceNumber: /\b(?:ref|reference|check)\s*#?\s*([a-z0-9-]+)/i.exec(line)?.[1] ?? null,
      sourcePage: pageNumber,
      confidence: balanceMatched ? "high" : "medium",
      fieldConfidence: { dates: "medium", amounts: "high", direction: balanceMatched ? "high" : "medium" },
      issues: balanceMatched ? [] : ["Debit or credit direction could not be verified from the running balance."],
    });
  }
  return rows.length > 0 ? rows : null;
}

function parseTransactions(text: string, accountType: PdfAccountType): ExtractedTransaction[] {
  const rows: ExtractedTransaction[] = [];
  const dateStartRe = new RegExp(
    `^\\s*(${shortMonthDatePattern}(?:,?\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|\\d{4}-\\d{2}-\\d{2})\\s+`,
    "i",
  );
  const moneyRe = /(\(?[+-]?\s*[$€£]?\s*\d[\d,]*(?:\.\d{1,2})?\)?)/g;
  const periodYear = /statement\s+period[\s\S]*?((?:19|20)\d{2})/i.exec(text)?.[1];
  const contextDate = documentDate(text);
  const year = periodYear ?? contextDate?.slice(0, 4) ?? /(?:19|20)\d{2}/.exec(text)?.[0] ?? new Date().getFullYear().toString();
  let lineNo = 2;
  let pageNumber: number | null = null;
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    const page = /^--- Page (\d+) ---$/.exec(line);
    if (page) {
      pageNumber = Number(page[1]);
      continue;
    }
    if (/balance|total|summary|minimum payment|credit limit/i.test(line)) continue;
    const dateMatch = dateStartRe.exec(line);
    if (!dateMatch) continue;
    const moneyMatches = [...line.matchAll(moneyRe)];
    const amountMatch = moneyMatches.at(-1);
    if (!amountMatch) continue;
    const posted = parseContextualDate(dateMatch[1], contextDate ?? `${year}-12-31`);
    const afterDate = line.slice(dateMatch[0].length);
    const secondDate = dateStartRe.exec(afterDate);
    const txnDate = secondDate
      ? parseContextualDate(secondDate[1], contextDate ?? `${year}-12-31`)
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
      sourcePage: pageNumber,
      confidence: hint ? "high" : "medium",
      fieldConfidence: { dates: "medium", amounts: "high", direction: hint ? "high" : "medium" },
      issues: hint ? [] : ["Debit or credit direction inferred from statement wording."],
    });
  }
  return rows;
}

function detectMultipleAccounts(text: string): boolean {
  const matches = [...text.matchAll(/(?:account|card)\s*(?:number|no\.?)?\s*[:#\-]?\s*(?:x{2,}|\*{2,}|ending\s+in)?\s*([*\dxX-]{2,20})/gi)]
    .map((m) => m[1].replace(/\D/g, "").slice(-4))
    .filter((v) => v.length >= 2);
  return new Set(matches).size > 1;
}

type AccountSectionHeading = { lineIndex: number; accountType: PdfAccountType; identifier: string | null };

function accountSectionHeading(line: string, lineIndex: number): AccountSectionHeading | null {
  if (!/(?:account|card)\s*(?:number|no\.?)/i.test(line)) return null;
  const accountType: PdfAccountType | null = /\bcredit card\b/i.test(line)
    ? "credit_card"
    : /\bchecking\b/i.test(line)
      ? "checking"
      : /\b(savings|regular share|share savings)\b/i.test(line)
        ? "savings"
        : null;
  if (!accountType) return null;
  const match = /(?:account|card)\s*(?:number|no\.?)?\s*[:#\-]?\s*(?:x{2,}|\*{2,}|ending\s+in)?\s*([*\dxX-]{2,20})/i.exec(line);
  const digits = match?.[1]?.replace(/\D/g, "") ?? "";
  return { lineIndex, accountType, identifier: digits.length >= 2 ? digits : null };
}

export function scopeStatementToAccount(
  text: string,
  target: { accountType: PdfAccountType; mask?: string | null },
): { text: string; issues: string[]; unsupportedReason: string | null } {
  const lines = text.split(/\n/);
  const headings = lines.map(accountSectionHeading).filter((heading): heading is AccountSectionHeading => heading !== null);
  const identities = new Set(headings.map((heading) => `${heading.accountType}:${heading.identifier ?? heading.lineIndex}`));
  if (identities.size <= 1) return { text, issues: [], unsupportedReason: null };

  const candidates = headings.filter((heading) => heading.accountType === target.accountType);
  const candidateIds = new Map<string, AccountSectionHeading>();
  for (const candidate of candidates) candidateIds.set(candidate.identifier ?? `line-${candidate.lineIndex}`, candidate);
  const mask = target.mask?.replace(/\D/g, "") ?? "";
  const selected = mask
    ? [...candidateIds.values()].find((candidate) => candidate.identifier?.endsWith(mask)) ?? null
    : candidateIds.size === 1 ? [...candidateIds.values()][0] : null;
  if (!selected) {
    return {
      text,
      issues: [],
      unsupportedReason: candidates.length === 0
        ? "This statement does not contain a section matching the selected account type."
        : "This statement contains multiple matching accounts. Add the account's masked digits or use a single-account statement.",
    };
  }

  const firstHeading = Math.min(...headings.map((heading) => heading.lineIndex));
  const selectedLines = lines.slice(0, firstHeading);
  let include = false;
  for (let index = firstHeading; index < lines.length; index += 1) {
    const heading = accountSectionHeading(lines[index], index);
    if (heading) {
      include = heading.accountType === selected.accountType
        && (selected.identifier === null || heading.identifier === selected.identifier);
    }
    if (include) selectedLines.push(lines[index]);
  }
  return {
    text: selectedLines.join("\n"),
    issues: [`This PDF contains multiple accounts. Only the selected ${target.accountType.replace("_", " ")} section was staged; other account sections were skipped.`],
    unsupportedReason: null,
  };
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

function confidence(
  metadata: StatementMetadata,
  txns: ExtractedTransaction[],
  recon: ReconciliationResult,
  extractionMethod: "native_text" | "ocr" | "hybrid",
): ConfidenceLevel {
  if (txns.length === 0) return "low";
  if (
    extractionMethod === "native_text"
    && metadata.accountType
    && metadata.statementEndDate
    && metadata.endingBalance !== null
    && recon.status === "reconciled"
  ) return "high";
  if (metadata.accountType && metadata.statementEndDate && metadata.endingBalance !== null) return "medium";
  return "low";
}

export function parseGenericStatement(text: string, extractionMethod: "native_text" | "ocr" | "hybrid" = "native_text"): ParsedStatement {
  const cls = classifyStatement(text);
  if (cls.unsupportedReason || !cls.accountType) {
    return {
      metadata: blankMetadata(),
      transactions: [],
      extractionMethod,
      confidence: "low",
      fieldConfidence: {},
      reconciliation: { status: "not_enough_information", difference: null, tolerance: 0.01, equation: null },
      issues: [],
      unsupportedReason: cls.unsupportedReason,
      rawTextExcerpt: text.slice(0, 4000),
    };
  }
  if (detectMultipleAccounts(text)) {
    return {
      metadata: blankMetadata(),
      transactions: [],
      extractionMethod,
      confidence: "low",
      fieldConfidence: {},
      reconciliation: { status: "not_enough_information", difference: null, tolerance: 0.01, equation: null },
      issues: ["Multiple masked account identifiers were detected."],
      unsupportedReason: "This statement appears to contain multiple accounts. Multi-account PDFs are not supported yet.",
      rawTextExcerpt: text.slice(0, 4000),
    };
  }
  const metadata = parseMetadata(text, cls.accountType);
  const transactions = parseColumnarTransactions(text, cls.accountType, metadata) ?? parseTransactions(text, cls.accountType);
  const reconciliation = reconcileStatement(metadata, transactions);
  const fieldConfidence: FieldConfidence = {
    dates: metadata.statementStartDate && metadata.statementEndDate ? "high" : "low",
    amounts: transactions.length > 0 ? "high" : "low",
    direction: transactions.some((t) => t.issues.length) ? "medium" : "high",
    endingBalance: metadata.endingBalance !== null ? "high" : "low",
      accountIdentification: metadata.maskedAccountNumber || metadata.institution ? "medium" : "low",
  };
  const ocrIssues = extractionMethod === "ocr" || extractionMethod === "hybrid"
    ? ["OCR was used. Review balances and transaction amounts before importing."]
    : [];
  const activityIssues = /\bposted transactions since your last statement\b/i.test(text)
    ? ["This is posted transaction activity, not a monthly statement. Statement balances and reconciliation are unavailable."]
    : [];
  return {
    metadata,
    transactions,
    extractionMethod,
    confidence: confidence(metadata, transactions, reconciliation, extractionMethod),
    fieldConfidence,
    reconciliation,
    issues: transactions.length === 0
      ? [...ocrIssues, ...activityIssues, "No transaction table rows were detected."]
      : [...ocrIssues, ...activityIssues],
    unsupportedReason: null,
    rawTextExcerpt: text.slice(0, 4000),
  };
}

export const parserMetadata = { parserVersion: PDF_IMPORT_PARSER_VERSION };
