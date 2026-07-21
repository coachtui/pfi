"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dedupeKey } from "@/lib/csv-import/dedupe";
import { dayGap, TRANSFER_MAX_DAY_GAP } from "@/lib/csv-import/transfers";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import { insertChunked } from "@/lib/data/insert-chunked";
import { paginateSelect } from "@/lib/data/paginate";
import {
  computeDiscrepancy, effectiveAnchor,
  type AccountInput, type AccountType, type BalanceAnchor, type TransactionInput,
} from "@/lib/financial-engine";
import {
  confirmPdfImportSchema,
  importTransactionsSchema,
  type ConfirmPdfImportInput,
  type ImportResult,
  type ImportTransactionsInput,
} from "@/lib/validation/imports";
import type { MutationResult } from "@/lib/validation/transactions";
import { extractPdfText } from "@/lib/pdf-import/extract";
import { fileSha256, likelyDuplicateTransaction } from "@/lib/pdf-import/dedupe";
import { parseStatementWithRegistry } from "@/lib/pdf-import/registry";
import {
  PDF_IMPORT_BUCKET,
  PDF_IMPORT_PARSER_VERSION,
  type PdfReviewData,
  type StatementMetadata,
} from "@/lib/pdf-import/types";
import { validatePdfUpload } from "@/lib/pdf-import/validate";

// PostgREST caps unbounded selects at 1000 rows (see DECISIONS #18); the
// dedupe/transfer re-check below needs every existing transaction, not just
// the first page, or rows past the cap would re-import as duplicates.
const EXISTING_TXN_PAGE_SIZE = 1000;

/** Commit an import batch. The client's dedupe/transfer output is advisory:
 * everything is re-validated here against current DB state. All-or-nothing —
 * a failed chunk rolls the whole batch back. */
export async function importTransactions(input: ImportTransactionsInput): Promise<ImportResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = importTransactionsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const batchId = randomUUID();
  const { error: batchErr } = await supabase.from("import_batches").insert({
    id: batchId,
    user_id: user.id,
    source_type: "csv",
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
  });
  if (batchErr) return { error: batchErr.message };

  const result = await commitImportedTransactions(parsed.data, { batchId, userId: user.id });
  if (result.error) {
    await supabase.from("import_batches").update({ status: "failed", failure_reason: result.error }).eq("id", batchId);
  }
  return result;
}

async function commitImportedTransactions(
  v: ImportTransactionsInput,
  opts: { batchId: string; userId: string; allowDuplicateLines?: ReadonlySet<number> },
): Promise<ImportResult> {
  const supabase = await createClient();

  const { data: account, error: acctErr } = await supabase
    .from("financial_accounts")
    .select("id, provider, type, archived_at")
    .eq("id", v.accountId)
    .maybeSingle();
  if (acctErr) return { error: acctErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider === "demo") return { error: "Imports go into your own accounts, not demo data" };
  if (account.archived_at) return { error: "This account is archived" };

  // Server-side dedupe re-check against current DB state (stale-client/race guard).
  let existingRows: Array<{
    id: string; account_id: string; posted_date: string; amount: number;
    direction: string; description: string; is_transfer: boolean; transfer_pair_id: string | null;
  }>;
  try {
    existingRows = await paginateSelect(EXISTING_TXN_PAGE_SIZE, (from, to) =>
      supabase.from("transactions")
        .select("id, account_id, posted_date, amount, direction, description, is_transfer, transfer_pair_id")
        .order("id", { ascending: true })
        .range(from, to));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to read existing transactions" };
  }
  const existing = existingRows.map((t) => ({
    id: t.id as string,
    accountId: t.account_id as string,
    postedDate: t.posted_date as string,
    amount: Number(t.amount),
    direction: t.direction as "inflow" | "outflow",
    description: t.description as string,
    isTransfer: t.is_transfer as boolean,
    transferPairId: t.transfer_pair_id as string | null,
  }));

  const seen = new Set(
    existing.filter((t) => t.accountId === v.accountId).map((t) => dedupeKey(v.accountId, t)),
  );
  const fresh: typeof v.rows = [];
  let skippedDuplicates = 0;
  for (const r of v.rows) {
    const key = dedupeKey(v.accountId, r);
    if (seen.has(key) && !opts.allowDuplicateLines?.has(r.line)) { skippedDuplicates++; continue; }
    seen.add(key);
    fresh.push(r);
  }
  if (fresh.length === 0) return { error: "Nothing new to import — every row already exists" };

  // Re-validate transfer pairs; invalid ones are dropped (the row still
  // imports, unflagged) rather than failing the whole import.
  const byId = new Map(existing.map((t) => [t.id, t]));
  const byLine = new Map(fresh.map((r) => [r.line, r]));
  const usedExisting = new Set<string>();
  const pairByLine = new Map<number, string>();
  for (const p of v.transferPairs) {
    const row = byLine.get(p.line);
    const other = byId.get(p.existingId);
    if (!row || !other || usedExisting.has(other.id)) continue;
    if (other.accountId === v.accountId || other.transferPairId !== null) continue;
    if (other.direction === row.direction || other.amount !== row.amount) continue;
    if (dayGap(other.postedDate, row.postedDate) > TRANSFER_MAX_DAY_GAP) continue;
    usedExisting.add(other.id);
    pairByLine.set(p.line, other.id);
  }

  const batchId = opts.batchId;
  const inserts = fresh.map((r) => {
    const pairedWith = pairByLine.get(r.line) ?? null;
    return {
      account_id: v.accountId,
      user_id: opts.userId,
      posted_date: r.postedDate,
      amount: r.amount,
      direction: r.direction,
      description: r.description,
      category: r.category,
      is_transfer: pairedWith !== null,
      transfer_pair_id: pairedWith,
      import_batch_id: batchId,
    };
  });

  try {
    await insertChunked(supabase, "transactions", inserts);
  } catch (e) {
    // All-or-nothing: remove whatever landed before the failing chunk.
    const { error: cleanupErr } = await supabase.from("transactions").delete().eq("import_batch_id", batchId);
    const baseMessage = e instanceof Error ? e.message : "Import failed";
    if (cleanupErr) {
      return {
        error: `${baseMessage} — cleanup also failed, some rows may remain (batch ${batchId}). Contact support with this batch id.`,
      };
    }
    return { error: `${baseMessage} — nothing was saved` };
  }

  // Statement anchor (optional): server-side reconciliation over existing +
  // just-inserted rows — the client's preview math is advisory. The anchor
  // row is provenance; the rebuild below derives current_balance from it.
  let anchorFacts: Pick<ImportResult, "anchorDate" | "anchoredBalance" | "discrepancy"> = {};
  if (v.endingBalance !== undefined && v.anchorDate !== undefined) {
    let priorAnchors: BalanceAnchor[] = [];
    try {
      const anchorRows = await paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(
        EXISTING_TXN_PAGE_SIZE,
        (from, to) =>
          supabase.from("balance_anchors")
            .select("account_id, anchor_date, balance, created_at")
            .eq("account_id", v.accountId)
            .order("id", { ascending: true })
            .range(from, to),
      );
      priorAnchors = anchorRows.map((r) => ({
        accountId: r.account_id, anchorDate: r.anchor_date, balance: Number(r.balance), createdAt: r.created_at,
      }));
    } catch (e) {
      const finish = await finishWithRebuild(supabase);
      return {
        ...finish,
        warning: [finish.warning, `Imported, but the balance anchor could not be saved: ${e instanceof Error ? e.message : "anchor lookup failed"}`].filter(Boolean).join(" "),
        batchId, imported: inserts.length, skippedDuplicates,
      };
    }

    const acctForMath: AccountInput = {
      id: v.accountId, type: account.type as AccountType, currentBalance: 0, includeInCalculations: true,
    };
    const mathTxns: TransactionInput[] = [
      ...existing
        .filter((t) => t.accountId === v.accountId)
        .map((t) => ({
          id: t.id, accountId: t.accountId, postedDate: t.postedDate, amount: t.amount,
          direction: t.direction, description: t.description, category: null,
          essential: null, isTransfer: t.isTransfer, transferPairId: t.transferPairId,
        })),
      ...inserts.map((r, i) => ({
        id: `pending-${i}`, accountId: r.account_id, postedDate: r.posted_date, amount: r.amount,
        direction: r.direction as "inflow" | "outflow", description: r.description, category: null,
        essential: null, isTransfer: r.is_transfer, transferPairId: null,
      })),
    ];
    const eff = effectiveAnchor(priorAnchors);
    const discrepancy = computeDiscrepancy(acctForMath, eff, v.endingBalance, v.anchorDate, mathTxns);

    const { error: anchorInsErr } = await supabase.from("balance_anchors").insert({
      user_id: opts.userId, account_id: v.accountId, anchor_date: v.anchorDate,
      balance: v.endingBalance, source: "import", import_batch_id: batchId, discrepancy,
    });
    if (anchorInsErr) {
      const finish = await finishWithRebuild(supabase);
      return {
        ...finish,
        warning: [finish.warning, `Imported, but the balance anchor could not be saved: ${anchorInsErr.message}`].filter(Boolean).join(" "),
        batchId, imported: inserts.length, skippedDuplicates,
      };
    }
    anchorFacts = { anchorDate: v.anchorDate, anchoredBalance: v.endingBalance, discrepancy };
  }

  const finish = await finishWithRebuild(supabase);
  return { ...finish, ...anchorFacts, batchId, imported: inserts.length, skippedDuplicates };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asReconciliation(value: unknown): PdfReviewData["reconciliation"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return {
    status: String(v.status) as NonNullable<PdfReviewData["reconciliation"]>["status"],
    difference: typeof v.difference === "number" ? v.difference : v.difference === null ? null : Number(v.difference),
    tolerance: typeof v.tolerance === "number" ? v.tolerance : 0.01,
    equation: typeof v.equation === "string" ? v.equation : null,
  };
}

async function readPdfReview(importId: string): Promise<{ data: PdfReviewData | null; error: string }> {
  const supabase = await createClient();
  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .select("*")
    .eq("id", importId)
    .eq("source_type", "pdf")
    .maybeSingle();
  if (batchErr) return { data: null, error: batchErr.message };
  if (!batch) return { data: null, error: "Import not found" };

  const [{ data: meta, error: metaErr }, { data: staged, error: stagedErr }, { data: accounts, error: acctErr }] = await Promise.all([
    supabase.from("staged_statement_metadata").select("*").eq("import_batch_id", importId).maybeSingle(),
    supabase.from("staged_transactions").select("*").eq("import_batch_id", importId).order("posted_date", { ascending: true }),
    supabase.from("financial_accounts").select("id, institution, type, mask, archived_at"),
  ]);
  if (metaErr) return { data: null, error: metaErr.message };
  if (stagedErr) return { data: null, error: stagedErr.message };
  if (acctErr) return { data: null, error: acctErr.message };

  const metadata: StatementMetadata = {
    institution: meta?.institution ?? null,
    accountName: meta?.account_name ?? null,
    accountType: meta?.account_type ?? null,
    maskedAccountNumber: meta?.masked_account_number ?? null,
    statementStartDate: meta?.statement_start_date ?? null,
    statementEndDate: meta?.statement_end_date ?? null,
    beginningBalance: meta?.beginning_balance === null || meta?.beginning_balance === undefined ? null : Number(meta.beginning_balance),
    endingBalance: meta?.ending_balance === null || meta?.ending_balance === undefined ? null : Number(meta.ending_balance),
    availableBalance: meta?.available_balance === null || meta?.available_balance === undefined ? null : Number(meta.available_balance),
    creditLimit: meta?.credit_limit === null || meta?.credit_limit === undefined ? null : Number(meta.credit_limit),
    minimumPayment: meta?.minimum_payment === null || meta?.minimum_payment === undefined ? null : Number(meta.minimum_payment),
    paymentDueDate: meta?.payment_due_date ?? null,
  };
  const suggested = (accounts ?? []).find((a) =>
    !a.archived_at
    && (!metadata.accountType || a.type === metadata.accountType)
    && (!metadata.institution || !a.institution || a.institution.toLowerCase() === metadata.institution.toLowerCase())
    && (!metadata.maskedAccountNumber || !a.mask || metadata.maskedAccountNumber.endsWith(a.mask)),
  )?.id ?? null;

  return {
    error: "",
    data: {
      importId,
      status: batch.status,
      originalFilename: batch.original_filename ?? "",
      storagePath: batch.storage_path ?? "",
      detectedInstitution: batch.detected_institution ?? null,
      detectedAccountType: batch.detected_account_type ?? null,
      statementStartDate: batch.statement_start_date ?? null,
      statementEndDate: batch.statement_end_date ?? null,
      extractionMethod: batch.extraction_method ?? null,
      confidence: batch.confidence ?? null,
      failureReason: batch.failure_reason ?? null,
      unsupportedReason: batch.unsupported_reason ?? null,
      validationResults: asStringArray(batch.validation_results),
      reconciliation: asReconciliation(batch.reconciliation_results),
      metadata,
      fieldConfidence: meta?.field_confidence ?? {},
      transactions: (staged ?? []).map((r) => ({
        stagedId: r.id,
        line: 2,
        postedDate: r.posted_date,
        transactionDate: r.transaction_date,
        amount: Number(r.amount),
        direction: r.direction,
        description: r.description,
        category: r.category ?? (r.direction === "inflow" ? "income" : "other"),
        referenceNumber: r.reference_number,
        sourcePage: r.source_page,
        confidence: r.confidence,
        fieldConfidence: r.field_confidence ?? {},
        issues: asStringArray(r.issues),
        excluded: r.excluded,
        duplicateOfTransactionId: r.duplicate_of_transaction_id,
      })),
      suggestedAccountId: suggested,
    },
  };
}

export async function uploadStatementPdf(formData: FormData): Promise<{ error: string; review?: PdfReviewData }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a PDF statement first." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validatePdfUpload({
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    bytes,
  });
  if (!validation.ok) return { error: validation.reason ?? "The PDF could not be validated." };

  const sha = fileSha256(bytes);
  const { data: duplicate, error: dupErr } = await supabase
    .from("import_batches")
    .select("id, status, failure_reason, unsupported_reason")
    .eq("user_id", user.id)
    .eq("source_type", "pdf")
    .eq("file_sha256", sha)
    .neq("status", "cancelled")
    .maybeSingle();
  if (dupErr) return { error: dupErr.message };
  if (duplicate) {
    if (duplicate.status === "ready_for_review" || duplicate.status === "needs_review") {
      const review = await readPdfReview(duplicate.id);
      return review.data ? { error: "", review: review.data } : { error: review.error };
    }
    if (duplicate.status === "confirmed") {
      return { error: "This statement PDF was already confirmed and added to your financial record." };
    }
    if (duplicate.status === "failed") {
      return {
        error: `This statement PDF was already uploaded, but extraction failed: ${duplicate.failure_reason ?? "No financial data was extracted."}`,
      };
    }
    if (duplicate.status === "unsupported") {
      return {
        error: `This statement PDF was already uploaded, but it is not supported: ${duplicate.unsupported_reason ?? "Unsupported statement type."}`,
      };
    }
    return { error: "This statement PDF was already uploaded and is still processing. Refresh the import screen in a moment." };
  }

  const importId = randomUUID();
  const storagePath = `${user.id}/${importId}.pdf`;
  const { error: batchErr } = await supabase.from("import_batches").insert({
    id: importId,
    user_id: user.id,
    source_type: "pdf",
    status: "uploaded",
    original_filename: file.name,
    storage_path: storagePath,
    file_sha256: sha,
    parser_version: PDF_IMPORT_PARSER_VERSION,
    validation_results: [],
  });
  if (batchErr) return { error: batchErr.message };

  const { error: uploadErr } = await supabase.storage.from(PDF_IMPORT_BUCKET).upload(storagePath, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploadErr) {
    await supabase.from("import_batches").update({ status: "failed", failure_reason: uploadErr.message }).eq("id", importId);
    return { error: uploadErr.message };
  }
  await supabase.from("import_files").insert({
    user_id: user.id,
    import_batch_id: importId,
    bucket_id: PDF_IMPORT_BUCKET,
    storage_path: storagePath,
    original_filename: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    page_count: validation.pageCount ?? null,
    file_sha256: sha,
  });

  await supabase.from("import_batches").update({ status: "extracting" }).eq("id", importId);
  try {
    const extracted = extractPdfText(bytes);
    if (extracted.scanned) {
      await supabase.from("import_batches").update({
        status: "failed",
        extraction_method: "ocr",
        confidence: "low",
        failure_reason: "Scanned document could not be read. OCR is detected but not enabled for this importer yet.",
        validation_results: ["No usable embedded text was found."],
      }).eq("id", importId);
      const review = await readPdfReview(importId);
      return review.data ? { error: "", review: review.data } : { error: review.error };
    }

    const parsed = parseStatementWithRegistry(extracted.text);
    const status = parsed.unsupportedReason
      ? "unsupported"
      : parsed.transactions.length === 0
        ? "failed"
        : parsed.reconciliation.status === "does_not_reconcile" || parsed.confidence === "low"
          ? "needs_review"
          : "ready_for_review";
    const failureReason = parsed.transactions.length === 0 && !parsed.unsupportedReason ? "No financial transaction data was detected." : null;

    await supabase.from("import_batches").update({
      status,
      detected_institution: parsed.metadata.institution,
      detected_account_type: parsed.metadata.accountType,
      statement_start_date: parsed.metadata.statementStartDate,
      statement_end_date: parsed.metadata.statementEndDate,
      extraction_method: parsed.extractionMethod,
      confidence: parsed.confidence,
      validation_results: parsed.issues,
      reconciliation_results: parsed.reconciliation,
      failure_reason: failureReason,
      unsupported_reason: parsed.unsupportedReason,
    }).eq("id", importId);
    await supabase.from("staged_statement_metadata").insert({
      import_batch_id: importId,
      user_id: user.id,
      institution: parsed.metadata.institution,
      account_name: parsed.metadata.accountName,
      account_type: parsed.metadata.accountType,
      masked_account_number: parsed.metadata.maskedAccountNumber,
      statement_start_date: parsed.metadata.statementStartDate,
      statement_end_date: parsed.metadata.statementEndDate,
      beginning_balance: parsed.metadata.beginningBalance,
      ending_balance: parsed.metadata.endingBalance,
      available_balance: parsed.metadata.availableBalance,
      credit_limit: parsed.metadata.creditLimit,
      minimum_payment: parsed.metadata.minimumPayment,
      payment_due_date: parsed.metadata.paymentDueDate,
      raw_text_excerpt: parsed.rawTextExcerpt,
      parser_metadata: { adapterId: parsed.adapterId, parserVersion: PDF_IMPORT_PARSER_VERSION },
      field_confidence: parsed.fieldConfidence,
    });
    if (parsed.transactions.length > 0) {
      await insertChunked(supabase, "staged_transactions", parsed.transactions.map((t) => ({
        import_batch_id: importId,
        user_id: user.id,
        posted_date: t.postedDate,
        transaction_date: t.transactionDate,
        description: t.description,
        amount: t.amount,
        direction: t.direction,
        category: t.category,
        reference_number: t.referenceNumber,
        source_page: t.sourcePage,
        confidence: t.confidence,
        field_confidence: t.fieldConfidence,
        issues: t.issues,
        original_values: t,
      })));
    }
    const review = await readPdfReview(importId);
    return review.data ? { error: "", review: review.data } : { error: review.error };
  } catch (e) {
    const message = e instanceof Error ? e.message : "PDF extraction failed.";
    await supabase.from("import_batches").update({
      status: "failed",
      confidence: "low",
      failure_reason: "PDF extraction failed before review. Try a CSV export if available, or upload a different statement PDF.",
      validation_results: [message.slice(0, 180)],
    }).eq("id", importId);
    const review = await readPdfReview(importId);
    return review.data ? { error: "", review: review.data } : { error: "PDF extraction failed before review." };
  }
}

export async function getPdfImportReview(importId: string): Promise<{ error: string; review?: PdfReviewData }> {
  if (!z.uuid().safeParse(importId).success) return { error: "Invalid import" };
  const review = await readPdfReview(importId);
  return review.data ? { error: "", review: review.data } : { error: review.error };
}

export async function cancelPdfImport(importId: string): Promise<MutationResult> {
  if (!z.uuid().safeParse(importId).success) return { error: "Invalid import" };
  const supabase = await createClient();
  const { data: batch, error: fetchErr } = await supabase
    .from("import_batches")
    .select("id, storage_path, status")
    .eq("id", importId)
    .eq("source_type", "pdf")
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!batch) return { error: "Import not found" };
  if (batch.status === "confirmed") return { error: "Confirmed imports cannot be cancelled." };
  if (batch.storage_path) await supabase.storage.from(PDF_IMPORT_BUCKET).remove([batch.storage_path]);
  const { error } = await supabase.from("import_batches").update({ status: "cancelled" }).eq("id", importId);
  return { error: error?.message ?? "" };
}

export async function confirmPdfImport(input: ConfirmPdfImportInput): Promise<ImportResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const parsed = confirmPdfImportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .select("id, status, source_type")
    .eq("id", v.importId)
    .eq("source_type", "pdf")
    .maybeSingle();
  if (batchErr) return { error: batchErr.message };
  if (!batch) return { error: "Import not found" };
  if (!["ready_for_review", "needs_review"].includes(batch.status)) {
    return { error: "This PDF import is not ready to confirm." };
  }

  const existingRows = await paginateSelect<{
    id: string; account_id: string; posted_date: string; amount: number;
    direction: string; description: string; is_transfer: boolean; transfer_pair_id: string | null;
  }>(EXISTING_TXN_PAGE_SIZE, (from, to) =>
    supabase.from("transactions")
      .select("id, account_id, posted_date, amount, direction, description, is_transfer, transfer_pair_id")
      .order("id", { ascending: true })
      .range(from, to));
  const existing = existingRows.map((t) => ({
    id: t.id,
    accountId: t.account_id,
    postedDate: t.posted_date,
    amount: Number(t.amount),
    direction: t.direction as "inflow" | "outflow",
    description: t.description,
    isTransfer: t.is_transfer,
    transferPairId: t.transfer_pair_id,
  }));
  for (const row of v.rows) {
    const duplicate = likelyDuplicateTransaction(v.accountId, row, existing);
    const excluded = row.excluded || (duplicate !== null && row.duplicateDecision !== "import");
    await supabase.from("staged_transactions").update({
      excluded,
      duplicate_of_transaction_id: duplicate?.id ?? null,
      corrected_values: row,
    }).eq("id", row.stagedId).eq("import_batch_id", v.importId);
    if (excluded || duplicate || row.duplicateDecision === "import") {
      await supabase.from("import_corrections").insert({
        import_batch_id: v.importId,
        staged_transaction_id: row.stagedId,
        user_id: user.id,
        correction_type: excluded ? "excluded_or_duplicate" : "duplicate_accepted",
        original_value: { duplicateOfTransactionId: duplicate?.id ?? null },
        corrected_value: row,
      });
    }
  }

  const kept = v.rows.filter((r) => !r.excluded && !(likelyDuplicateTransaction(v.accountId, r, existing) && r.duplicateDecision !== "import"));
  if (kept.length === 0) return { error: "No reviewed transactions remain to import." };
  const commit = await commitImportedTransactions({
    accountId: v.accountId,
    rows: kept.map((r) => ({
      line: r.line,
      postedDate: r.postedDate,
      amount: r.amount,
      direction: r.direction,
      description: r.description,
      category: r.category,
    })),
    transferPairs: [],
    ...(v.metadata.endingBalance !== null && v.metadata.statementEndDate
      ? { endingBalance: v.metadata.endingBalance, anchorDate: v.metadata.statementEndDate }
      : {}),
  }, {
    batchId: v.importId,
    userId: user.id,
    allowDuplicateLines: new Set(v.rows.filter((r) => r.duplicateDecision === "import").map((r) => r.line)),
  });
  if (commit.error) {
    await supabase.from("import_batches").update({ status: "failed", failure_reason: commit.error }).eq("id", v.importId);
    return commit;
  }

  await supabase.from("staged_statement_metadata").update({
    institution: v.metadata.institution,
    account_name: v.metadata.accountName,
    account_type: v.metadata.accountType,
    masked_account_number: v.metadata.maskedAccountNumber,
    statement_start_date: v.metadata.statementStartDate,
    statement_end_date: v.metadata.statementEndDate,
    beginning_balance: v.metadata.beginningBalance,
    ending_balance: v.metadata.endingBalance,
    available_balance: v.metadata.availableBalance,
    credit_limit: v.metadata.creditLimit,
    minimum_payment: v.metadata.minimumPayment,
    payment_due_date: v.metadata.paymentDueDate,
  }).eq("import_batch_id", v.importId);
  await supabase.from("import_batches").update({
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    detected_institution: v.metadata.institution,
    detected_account_type: v.metadata.accountType,
    statement_start_date: v.metadata.statementStartDate,
    statement_end_date: v.metadata.statementEndDate,
  }).eq("id", v.importId);

  return commit;
}

/** Remove exactly one import batch's rows, then rebuild. */
export async function undoImport(batchId: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(batchId).success) return { error: "Invalid import" };

  const { data: deleted, error: delErr } = await supabase
    .from("transactions")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("user_id", user.id)
    .select("id");
  if (delErr) return { error: delErr.message };
  if (!deleted || deleted.length === 0) return { error: "Import not found" };

  // The batch's anchor (if any) claims a statement that no longer exists in
  // the data — remove it; the rebuild re-derives current_balance from the
  // remaining effective anchor.
  const { error: anchorDelErr } = await supabase
    .from("balance_anchors")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("user_id", user.id);
  if (anchorDelErr) {
    const finish = await finishWithRebuild(supabase);
    return {
      ...finish,
      warning: [finish.warning, `Undone, but the batch's balance anchor could not be removed: ${anchorDelErr.message}`].filter(Boolean).join(" "),
    };
  }

  return finishWithRebuild(supabase);
}
