"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Plus, ShieldAlert, XCircle } from "lucide-react";
import { AccountSheet } from "@/app/accounts/AccountSheet";
import { cancelPdfImport, confirmPdfImport } from "@/app/actions/imports";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/config/categories";
import { dedupeKey } from "@/lib/csv-import/dedupe";
import type { ExistingTxn, NormalizedRow } from "@/lib/csv-import/types";
import type { AccountSummary } from "@/lib/data/mappers";
import { formatDollars } from "@/lib/financial-engine/format";
import type { PdfReviewData, ReviewTransaction, StatementMetadata } from "@/lib/pdf-import/types";
import type { ImportResult } from "@/lib/validation/imports";
import { InlineError } from "@/components/ui/InlineError";

const inputCls = "rounded-xl border border-border-subtle bg-inset px-3 py-2 text-sm text-primary";
const labelCls = "text-xs font-medium text-primary";

function confidenceLabel(value: string | null | undefined) {
  if (!value) return "Unknown confidence";
  return `${value[0].toUpperCase()}${value.slice(1)} confidence`;
}

function reconText(review: PdfReviewData): string {
  const r = review.reconciliation;
  if (!r) return "Not enough information";
  if (r.status === "reconciled") return "Reconciled";
  if (r.status === "reconciled_within_tolerance") return "Reconciled within rounding tolerance";
  if (r.status === "not_enough_information") return "Not enough information";
  return `Does not reconcile${r.difference === null ? "" : ` (${formatDollars(Math.abs(r.difference))} difference)`}`;
}

export function PdfReviewStep({
  review,
  accounts,
  existing,
  initialAccountId,
  onConfirmed,
  onCancelled,
}: {
  review: PdfReviewData;
  accounts: AccountSummary[];
  existing: ExistingTxn[];
  initialAccountId: string;
  onConfirmed: (result: ImportResult, rows: NormalizedRow[], accountId: string) => void;
  onCancelled: () => void;
}) {
  const [metadata, setMetadata] = useState<StatementMetadata>(review.metadata);
  const [accountId, setAccountId] = useState(() => {
    const compatible = (id: string) => {
      const account = accounts.find((candidate) => candidate.id === id);
      return account
        && account.provider !== "demo"
        && (!review.metadata.accountType || account.type === review.metadata.accountType);
    };
    if (initialAccountId && compatible(initialAccountId)) return initialAccountId;
    if (review.suggestedAccountId && compatible(review.suggestedAccountId)) {
      return review.suggestedAccountId;
    }
    return "";
  });
  const [addingAccount, setAddingAccount] = useState(false);
  const [rows, setRows] = useState<ReviewTransaction[]>(review.transactions);
  const [importDuplicates, setImportDuplicates] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const duplicateByStagedId = useMemo(() => {
    const out = new Map<string, ExistingTxn>();
    if (!accountId) return out;
    const keys = new Map(existing.filter((t) => t.accountId === accountId).map((t) => [dedupeKey(accountId, t), t]));
    for (const row of rows) {
      const dupe = keys.get(dedupeKey(accountId, row));
      if (dupe) out.set(row.stagedId, dupe);
    }
    return out;
  }, [accountId, existing, rows]);

  const accepted = rows.filter((r) => !r.excluded && !(duplicateByStagedId.has(r.stagedId) && !importDuplicates.has(r.stagedId)));
  const issueCount = rows.reduce((n, r) => n + r.issues.length, 0);
  const lowConfidence = rows.filter((r) => r.confidence === "low").length;
  const blocked = review.status === "unsupported" || review.status === "failed";
  const usedOcr = review.extractionMethod === "ocr" || review.extractionMethod === "hybrid";
  const compatibleAccounts = accounts.filter(
    (account) =>
      account.provider !== "demo"
      && (!metadata.accountType || account.type === metadata.accountType),
  );

  function updateMeta<K extends keyof StatementMetadata>(key: K, value: StatementMetadata[K]) {
    setMetadata((cur) => ({ ...cur, [key]: value }));
  }

  function updateRow(id: string, patch: Partial<ReviewTransaction>) {
    setRows((cur) => cur.map((r) => (r.stagedId === id ? { ...r, ...patch } : r)));
  }

  function setDuplicateImport(id: string, checked: boolean) {
    setImportDuplicates((cur) => {
      const next = new Set(cur);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function confirm() {
    if (!accountId) {
      setError("Choose the account this statement belongs to.");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await confirmPdfImport({
        importId: review.importId,
        accountId,
        metadata,
        rows: rows.map((r) => ({
          stagedId: r.stagedId,
          line: r.line,
          postedDate: r.postedDate,
          transactionDate: r.transactionDate,
          amount: r.amount,
          direction: r.direction,
          description: r.description,
          category: r.category,
          referenceNumber: r.referenceNumber,
          sourcePage: r.sourcePage,
          confidence: r.confidence,
          excluded: r.excluded,
          duplicateDecision: duplicateByStagedId.has(r.stagedId) ? (importDuplicates.has(r.stagedId) ? "import" : "exclude") : null,
        })),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onConfirmed(result, accepted.map((r) => ({
        line: r.line,
        postedDate: r.postedDate,
        amount: r.amount,
        direction: r.direction,
        description: r.description,
        category: r.category,
      })), accountId);
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelPdfImport(review.importId);
      if (result.error) setError(result.error);
      else onCancelled();
    });
  }

  return (
    <section className="space-y-4">
      <div className="rounded-card border border-border-subtle bg-elevated p-4">
        <div className="flex items-start gap-3">
          {blocked ? <XCircle className="mt-0.5 text-negative" size={20} aria-hidden /> : <CheckCircle2 className="mt-0.5 text-positive" size={20} aria-hidden />}
          <div>
            <h2 className="text-sm font-semibold text-primary">
              {blocked ? "Statement cannot be imported" : `We found ${rows.length} transactions${metadata.endingBalance === null ? "" : ` and an ending balance of ${formatDollars(metadata.endingBalance)}`}.`}
            </h2>
            <p className="mt-1 text-sm text-secondary">
              Review the extracted data before adding it to PFI. Confidence means the parser matched expected patterns, not independent verification.
            </p>
          </div>
        </div>
      </div>

      {review.unsupportedReason && <p role="alert" className="rounded-card border border-warning bg-elevated p-3 text-sm text-warning"><ShieldAlert size={16} className="mr-1 inline" aria-hidden />{review.unsupportedReason}</p>}
      {review.failureReason && <p role="alert" className="rounded-card border border-negative bg-elevated p-3 text-sm text-negative">{review.failureReason}</p>}
      {usedOcr && !blocked && (
        <p role="status" className="rounded-card border border-warning bg-elevated p-3 text-sm text-warning">
          <AlertTriangle size={16} className="mr-1 inline" aria-hidden />
          This statement was scanned using OCR. Review all balances, dates, and transaction amounts before importing.
        </p>
      )}
      {review.validationResults.length > 0 && (
        <div className="rounded-card border border-border-subtle bg-elevated p-3 text-sm text-secondary">
          <p className="font-medium text-primary">Extraction notes</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {review.validationResults.map((result) => <li key={result}>{result}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="pdf-account" className={labelCls}>Account</label>
          <select id="pdf-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
            <option value="">Choose an account...</option>
            {compatibleAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.displayName}</option>
            ))}
          </select>
          {metadata.accountType && (
            <p className="mt-1 text-xs text-secondary">
              Detected {metadata.accountType.replace("_", " ")} activity. Only matching accounts are shown.
            </p>
          )}
          <button type="button" onClick={() => setAddingAccount(true)} className="mt-2 inline-flex items-center gap-1 text-sm text-secondary hover:text-primary">
            <Plus size={16} aria-hidden /> New account
          </button>
        </div>
        <div>
          <p className={labelCls}>Extraction</p>
          <p className="mt-1 text-sm text-primary">{review.extractionMethod ?? "Unknown"} · {confidenceLabel(review.confidence)}</p>
          {review.ocrProvider && <p className="text-xs text-secondary">OCR: {review.ocrProvider}{review.ocrAverageConfidence === null ? "" : ` · ${review.ocrAverageConfidence.toFixed(1)}% quality`}</p>}
          <p className="text-xs text-secondary">Reconciliation: {reconText(review)}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Institution</span>
          <input className={inputCls} value={metadata.institution ?? ""} onChange={(e) => updateMeta("institution", e.target.value || null)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Statement start</span>
          <input type="date" className={inputCls} value={metadata.statementStartDate ?? ""} onChange={(e) => updateMeta("statementStartDate", e.target.value || null)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Statement end</span>
          <input type="date" className={inputCls} value={metadata.statementEndDate ?? ""} onChange={(e) => updateMeta("statementEndDate", e.target.value || null)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Beginning balance</span>
          <input type="number" step="0.01" className={inputCls} value={metadata.beginningBalance ?? ""} onChange={(e) => updateMeta("beginningBalance", e.target.value === "" ? null : Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Ending balance</span>
          <input type="number" step="0.01" className={inputCls} value={metadata.endingBalance ?? ""} onChange={(e) => updateMeta("endingBalance", e.target.value === "" ? null : Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Masked account</span>
          <input className={inputCls} value={metadata.maskedAccountNumber ?? ""} onChange={(e) => updateMeta("maskedAccountNumber", e.target.value || null)} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full border border-border-subtle px-3 py-1">{rows.length} detected</span>
        <span className="rounded-full border border-border-subtle px-3 py-1">{duplicateByStagedId.size} possible duplicates</span>
        <span className="rounded-full border border-border-subtle px-3 py-1">{lowConfidence} low confidence</span>
        <span className="rounded-full border border-border-subtle px-3 py-1">{issueCount} parsing issues</span>
      </div>

      <div className="overflow-x-auto rounded-card border border-border-subtle">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="bg-inset text-left text-xs text-secondary">
            <tr>
              <th className="p-2">Use</th>
              <th className="p-2">Date</th>
              <th className="p-2">Description</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2">Direction</th>
              <th className="p-2">Category</th>
              <th className="p-2">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dupe = duplicateByStagedId.get(r.stagedId);
              return (
                <tr key={r.stagedId} className="border-t border-border-subtle align-top">
                  <td className="p-2">
                    <input type="checkbox" checked={!r.excluded} onChange={() => updateRow(r.stagedId, { excluded: !r.excluded })} aria-label={`Include ${r.description}`} />
                    {dupe && (
                      <label className="mt-2 block text-xs text-warning">
                        <input
                          type="checkbox"
                          checked={importDuplicates.has(r.stagedId)}
                          onChange={(e) => setDuplicateImport(r.stagedId, e.target.checked)}
                        /> import duplicate
                      </label>
                    )}
                  </td>
                  <td className="p-2"><input type="date" className={`${inputCls} w-36`} value={r.postedDate} onChange={(e) => updateRow(r.stagedId, { postedDate: e.target.value })} /></td>
                  <td className="p-2"><input className={`${inputCls} w-64`} value={r.description} onChange={(e) => updateRow(r.stagedId, { description: e.target.value })} /></td>
                  <td className="p-2 text-right"><input type="number" step="0.01" className={`${inputCls} w-28 text-right tabular-nums`} value={r.amount} onChange={(e) => updateRow(r.stagedId, { amount: Number(e.target.value) })} /></td>
                  <td className="p-2">
                    <select className={inputCls} value={r.direction} onChange={(e) => updateRow(r.stagedId, { direction: e.target.value as "inflow" | "outflow" })}>
                      <option value="inflow">Credit</option>
                      <option value="outflow">Debit</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <select className={inputCls} value={r.category} onChange={(e) => updateRow(r.stagedId, { category: e.target.value as Category })}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <span>{confidenceLabel(r.confidence)}</span>
                    {(dupe || r.issues.length > 0) && (
                      <p className="mt-1 text-xs text-warning">
                        <AlertTriangle size={13} className="mr-1 inline" aria-hidden />
                        {dupe ? "Possible duplicate. " : ""}{r.issues.join(" ")}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <InlineError message={error} />
      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" disabled={pending} onClick={cancel} className="rounded-xl border border-negative px-4 py-3 text-sm font-semibold text-negative disabled:opacity-60">
          Cancel import
        </button>
        <button type="button" disabled={pending || blocked || accepted.length === 0} onClick={confirm} className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60">
          {pending ? "Saving..." : `Confirm ${accepted.length} transaction${accepted.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <AccountSheet account={null} open={addingAccount} onClose={() => setAddingAccount(false)} />
    </section>
  );
}
