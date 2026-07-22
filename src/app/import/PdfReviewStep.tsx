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
import type { ConfidenceLevel, PdfReviewData, ReviewTransaction, StatementMetadata } from "@/lib/pdf-import/types";
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

/** Reconciliation status as an icon-paired chip — never color-only. */
function ReconciliationChip({ review }: { review: PdfReviewData }) {
  const status = review.reconciliation?.status;
  const positive = status === "reconciled" || status === "reconciled_within_tolerance";
  const unknown = !review.reconciliation || status === "not_enough_information";
  const tone = unknown ? "bg-neutral-muted text-secondary" : positive ? "bg-positive-muted text-positive" : "bg-warning-muted text-warning";
  const Icon = unknown ? ShieldAlert : positive ? CheckCircle2 : AlertTriangle;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
      <Icon size={13} aria-hidden /> {reconText(review)}
    </span>
  );
}

/** Compact count chip for the review summary row. Icon-paired when flagging a non-zero issue count. */
function StatChip({ value, label, warn }: { value: number; label: string; warn?: boolean }) {
  const active = Boolean(warn) && value > 0;
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-inset px-3 py-2">
      <span className={`flex items-center gap-1 font-mono text-base font-semibold tabular-nums ${active ? "text-warning" : "text-primary"}`}>
        {active && <AlertTriangle size={14} aria-hidden />}
        {value}
      </span>
      <span className="text-[10px] font-medium tracking-wide text-tertiary uppercase">{label}</span>
    </div>
  );
}

/** Per-transaction confidence chip. Pairs color with an icon and the word itself — never color alone. */
function ConfidenceChip({ value }: { value: ConfidenceLevel }) {
  const label = `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  const tone = value === "low" ? "bg-warning-muted text-warning" : value === "medium" ? "bg-neutral-muted text-secondary" : "bg-positive-muted text-positive";
  const Icon = value === "low" ? AlertTriangle : CheckCircle2;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tone}`}>
      <Icon size={12} aria-hidden /> {label}
    </span>
  );
}

/** Calm, honest presentation of the duplicate-decision toggle. Logic (setDuplicateImport) is unchanged. */
function DuplicateStrip({ checked, onToggle }: { checked: boolean; onToggle: (checked: boolean) => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning-muted px-3 py-2 text-xs text-warning">
      <span className="flex items-center gap-1.5">
        <AlertTriangle size={14} aria-hidden className="shrink-0" />
        Looks already imported — excluded by default.
      </span>
      <label className="flex shrink-0 items-center gap-1.5 font-medium text-warning">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        Import anyway
      </label>
    </div>
  );
}

export function PdfReviewStep({
  review,
  accounts,
  existing,
  initialAccountId,
  onBack,
  onConfirmed,
  onCancelled,
}: {
  review: PdfReviewData;
  accounts: AccountSummary[];
  existing: ExistingTxn[];
  initialAccountId: string;
  onBack?: () => void;
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
        <div className="flex flex-wrap items-start justify-between gap-3">
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
          {!blocked && <ReconciliationChip review={review} />}
        </div>
      </div>

      {blocked ? (
        <div className="rounded-card border border-negative/30 bg-elevated p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 shrink-0 text-negative" size={20} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-primary">
                {review.status === "unsupported" ? "This statement type isn't supported yet" : "We couldn't read this statement"}
              </p>
              <p className="mt-1 text-sm text-secondary">
                {review.unsupportedReason ?? review.failureReason ?? "This file could not be processed."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onCancelled}
                  className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base"
                >
                  Import a CSV instead
                </button>
                <button
                  type="button"
                  onClick={onBack ?? onCancelled}
                  className="rounded-xl border border-border-strong px-4 py-3 text-sm font-semibold text-primary"
                >
                  Try a different PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatChip value={rows.length} label="Detected" />
        <StatChip value={duplicateByStagedId.size} label="Possible duplicates" warn />
        <StatChip value={lowConfidence} label="Low confidence" warn />
        <StatChip value={issueCount} label="Parsing issues" warn />
      </div>

      <div className="divide-y divide-border-subtle rounded-card border border-border-subtle bg-elevated">
        {rows.length === 0 && (
          <p className="p-4 text-sm text-secondary">No transactions were extracted from this statement.</p>
        )}
        {rows.map((r) => {
          const dupe = duplicateByStagedId.get(r.stagedId);
          const inflow = r.direction === "inflow";
          return (
            <div key={r.stagedId} className={`p-3 sm:p-4 ${r.excluded ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={!r.excluded}
                    onChange={() => updateRow(r.stagedId, { excluded: !r.excluded })}
                    aria-label={`Include ${r.description}`}
                    className="mt-2 size-4 shrink-0 accent-positive-strong"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      className={`w-full ${inputCls} font-medium`}
                      value={r.description}
                      onChange={(e) => updateRow(r.stagedId, { description: e.target.value })}
                      aria-label="Description"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        className={`${inputCls} w-auto font-mono text-xs text-tertiary`}
                        value={r.postedDate}
                        onChange={(e) => updateRow(r.stagedId, { postedDate: e.target.value })}
                        aria-label="Date"
                      />
                      <select
                        className={`${inputCls} w-auto text-xs`}
                        value={r.direction}
                        onChange={(e) => updateRow(r.stagedId, { direction: e.target.value as "inflow" | "outflow" })}
                        aria-label="Direction"
                      >
                        <option value="inflow">Credit</option>
                        <option value="outflow">Debit</option>
                      </select>
                      <select
                        className={`${inputCls} w-auto text-xs`}
                        value={r.category}
                        onChange={(e) => updateRow(r.stagedId, { category: e.target.value as Category })}
                        aria-label="Category"
                      >
                        {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="flex items-center gap-1">
                    <span aria-hidden className={`font-mono text-sm font-semibold ${inflow ? "text-positive" : "text-primary"}`}>
                      {inflow ? "+" : "−"}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className={`${inputCls} w-24 text-right font-mono text-sm font-semibold tabular-nums ${inflow ? "text-positive" : "text-primary"}`}
                      value={r.amount}
                      onChange={(e) => updateRow(r.stagedId, { amount: Number(e.target.value) })}
                      aria-label="Amount"
                    />
                  </div>
                  <ConfidenceChip value={r.confidence} />
                </div>
              </div>

              {dupe && (
                <DuplicateStrip
                  checked={importDuplicates.has(r.stagedId)}
                  onToggle={(checked) => setDuplicateImport(r.stagedId, checked)}
                />
              )}
              {!dupe && r.issues.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                  {r.issues.join(" ")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <InlineError message={error} />
      {!blocked && (
        <div className="flex flex-wrap gap-2 pt-2">
          {onBack && (
            <button type="button" disabled={pending} onClick={onBack} className="rounded-xl border border-border-strong px-4 py-3 text-sm font-semibold text-primary disabled:opacity-60">
              Back
            </button>
          )}
          <button type="button" disabled={pending} onClick={cancel} className="rounded-xl border border-negative px-4 py-3 text-sm font-semibold text-negative disabled:opacity-60">
            Cancel import
          </button>
          <button type="button" disabled={pending || accepted.length === 0} onClick={confirm} className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60">
            {pending ? "Saving..." : `Confirm ${accepted.length} transaction${accepted.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
      <AccountSheet account={null} open={addingAccount} onClose={() => setAddingAccount(false)} />
    </section>
  );
}
