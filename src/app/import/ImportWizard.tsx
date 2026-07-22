"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, FileSpreadsheet, FileText, Plus } from "lucide-react";
import { AccountSheet } from "@/app/accounts/AccountSheet";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ColumnMapping, ExistingTxn, NormalizedRow, ParsedCsv } from "@/lib/csv-import/types";
import { profileCsvColumns, proposeMapping } from "@/lib/csv-import/detect";
import { normalizeRows } from "@/lib/csv-import/normalize";
import { markDuplicates } from "@/lib/csv-import/dedupe";
import { detectTransfers } from "@/lib/csv-import/transfers";
import { UploadStep } from "./UploadStep";
import { MapStep } from "./MapStep";
import { PreviewStep } from "./PreviewStep";
import { SummaryStep } from "./SummaryStep";
import { PdfUploadStep } from "./PdfUploadStep";
import { PdfReviewStep } from "./PdfReviewStep";
import { ImportStepper } from "./ImportStepper";
import { importTransactions } from "@/app/actions/imports";
import { suggestCsvMapping } from "@/app/actions/csv-mapping";
import type { ImportResult } from "@/lib/validation/imports";
import type { PdfReviewData } from "@/lib/pdf-import/types";

type ImportMode = "csv" | "pdf";
type MappingSource = "automatic" | "assisted" | "manual";
type Step = "account" | "choose" | "upload" | "map" | "preview" | "pdfReview" | "summary";
const STEP_LABELS: Record<Step, string> = {
  account: "Choose account",
  choose: "Choose format",
  upload: "Choose file",
  map: "Map columns",
  preview: "Preview",
  pdfReview: "Review PDF",
  summary: "Done",
};

export function ImportWizard(props: {
  accounts: AccountSummary[];
  existing: ExistingTxn[];
  // Effective anchor per account, keyed by account id.
  anchors: Record<string, { anchorDate: string; balance: number }>;
}) {
  const { accounts } = props;
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [step, setStep] = useState<Step>("account");
  const [accountId, setAccountId] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [mappingSource, setMappingSource] = useState<MappingSource | null>(null);
  const [mappingNotice, setMappingNotice] = useState("");
  const [pdfReview, setPdfReview] = useState<PdfReviewData | null>(null);
  const [summaryRows, setSummaryRows] = useState<NormalizedRow[] | null>(null);
  const [summaryAccountId, setSummaryAccountId] = useState("");
  const [removedPairs, setRemovedPairs] = useState<Set<number>>(new Set());
  const [endingBalance, setEndingBalance] = useState("");
  const [anchorDate, setAnchorDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const preview = useMemo(() => {
    if (!parsed || !mapping || !accountId) return null;
    const normalized = normalizeRows(parsed, mapping);
    const { fresh, duplicates } = markDuplicates(normalized.rows, accountId, props.existing);
    const pairs = detectTransfers(fresh, accountId, props.existing);
    // Combine pre-mapping parse errors (overlong rows, unclosed quotes) with
    // post-mapping normalize errors so the preview never silently drops rows.
    const errors = [...parsed.errors, ...normalized.errors];
    return { fresh, duplicates, pairs, errors };
  }, [parsed, mapping, accountId, props.existing]);

  const defaultAnchorDate = useMemo(() => {
    if (!preview || preview.fresh.length === 0) return "";
    return preview.fresh.reduce(
      (m, r) => (r.postedDate > m ? r.postedDate : m),
      preview.fresh[0].postedDate,
    );
  }, [preview]);

  const onTogglePair = (line: number) => {
    setRemovedPairs((cur) => {
      const next = new Set(cur);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  const onCommit = async () => {
    if (!preview || submitting) return;
    const trimmed = endingBalance.trim();
    let anchor: { endingBalance: number; anchorDate: string } | undefined;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        setSubmitError("Ending balance must be a number — or leave it blank to skip anchoring.");
        return;
      }
      anchor = { endingBalance: n, anchorDate: anchorDate || defaultAnchorDate };
    }
    setSubmitting(true);
    setSubmitError("");
    const res = await importTransactions({
      accountId,
      rows: preview.fresh,
      transferPairs: preview.pairs.filter((p) => !removedPairs.has(p.line)),
      ...(anchor ?? {}),
    });
    setSubmitting(false);
    if (res.error) {
      setSubmitError(res.error);
      return;
    }
    setResult(res);
    setSummaryRows(preview.fresh);
    setSummaryAccountId(accountId);
    setStep("summary");
  };

  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;

  const prepareCsv = async (nextParsed: ParsedCsv, name: string) => {
    if (!selectedAccount) return;
    const proposal = proposeMapping(nextParsed, selectedAccount.type);
    let nextMapping = proposal.mapping;
    let assisted = false;

    if (proposal.confidence.overall === "low" || proposal.unmatchedCategoryValues.length > 0) {
      let suggestion = null;
      try {
        ({ suggestion } = await suggestCsvMapping({
          accountType: selectedAccount.type,
          columns: profileCsvColumns(nextParsed),
          categoryValues: proposal.unmatchedCategoryValues,
        }));
      } catch {
        // AI mapping is optional. Deterministic/manual mapping remains available.
      }
      if (suggestion) {
        assisted = true;
        const suggested = suggestion.columns;
        nextMapping = {
          ...nextMapping,
          date: nextMapping.date === -1 ? (suggested.date ?? -1) : nextMapping.date,
          description:
            nextMapping.description === -1
              ? (suggested.description ?? -1)
              : nextMapping.description,
          amount:
            nextMapping.amount === -1 && nextMapping.debit === -1 && nextMapping.credit === -1
              ? (suggested.amount ?? -1)
              : nextMapping.amount,
          debit:
            nextMapping.amount === -1 && nextMapping.debit === -1
              ? (suggested.debit ?? -1)
              : nextMapping.debit,
          credit:
            nextMapping.amount === -1 && nextMapping.credit === -1
              ? (suggested.credit ?? -1)
              : nextMapping.credit,
          category: nextMapping.category === -1 ? (suggested.category ?? -1) : nextMapping.category,
          signConvention:
            proposal.confidence.signConvention === "low" && suggestion.signConvention
              ? suggestion.signConvention
              : nextMapping.signConvention,
          categoryValues: { ...nextMapping.categoryValues, ...suggestion.categoryValues },
        };
        if (nextMapping.amount !== -1) {
          nextMapping = { ...nextMapping, debit: -1, credit: -1 };
        }
      }
    }

    setParsed(nextParsed);
    setFileName(name);
    setMapping(nextMapping);
    setRemovedPairs(new Set());
    setEndingBalance("");
    setAnchorDate("");

    if (proposal.confidence.overall === "high") {
      const unmatched = proposal.unmatchedCategoryValues.filter(
        (value) => nextMapping.categoryValues[value] === undefined,
      );
      setMappingSource("automatic");
      setMappingNotice(
        unmatched.length > 0
          ? `${unmatched.length} unfamiliar bank categor${unmatched.length === 1 ? "y uses" : "ies use"} a safe default. Review categories before importing.`
          : "Dates, descriptions, amounts, and available categories were recognized from this file.",
      );
      setStep("preview");
      return;
    }

    setMappingSource(assisted ? "assisted" : "manual");
    setMappingNotice("");
    setStep("map");
  };

  const showMapStep = step === "map" || mappingSource === "assisted" || mappingSource === "manual";
  const steps =
    mode === "pdf"
      ? (["account", "choose", "upload", "pdfReview", "summary"] as Step[])
      : mode === "csv"
        ? ([
            "account",
            "choose",
            "upload",
            ...(showMapStep ? ["map" as Step] : []),
            "preview",
            "summary",
          ] as Step[])
        : (["account", "choose"] as Step[]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/accounts"
          aria-label="Back to accounts"
          className="rounded-lg p-1 text-secondary hover:text-primary"
        >
          <ArrowLeft size={20} aria-hidden />
        </Link>
        <h1 className="text-lg font-semibold text-primary">Import financial data</h1>
      </div>

      <ImportStepper steps={steps} current={step} labels={STEP_LABELS} />

      {step === "account" && (
        <section className="flex flex-col gap-4">
          <div>
            <label htmlFor="import-account" className="mb-1 block text-sm font-medium text-primary">
              Import into which account?
            </label>
            <p className="mb-2 text-xs text-secondary">
              Choose the household bank or card account these transactions belong to.
            </p>
            <select
              id="import-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary focus:border-border-strong focus:outline-none"
            >
              <option value="">Choose an account...</option>
              {accounts
                .filter((a) => a.provider !== "demo")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => setAddingAccount(true)}
              className="mt-2 inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"
            >
              <Plus size={16} aria-hidden /> New account
            </button>
          </div>
          <button
            type="button"
            disabled={!accountId}
            onClick={() => setStep("choose")}
            className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
          >
            Continue
          </button>
          {!accountId && <p className="text-xs text-secondary">Pick or create an account first.</p>}
          <AccountSheet
            account={null}
            open={addingAccount}
            onClose={() => setAddingAccount(false)}
          />
        </section>
      )}

      {step === "choose" && (
        <section className="space-y-4">
          <div className="rounded-card border border-border-subtle bg-elevated p-3">
            <p className="text-xs text-secondary">Selected account</p>
            <p className="text-sm font-semibold text-primary">
              {selectedAccount?.displayName ?? "No account selected"}
            </p>
            <button
              type="button"
              onClick={() => setStep("account")}
              className="mt-1 text-sm text-secondary hover:text-primary"
            >
              Change account
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setMode("csv");
                setStep("upload");
              }}
              className="rounded-card border border-border-subtle bg-elevated p-4 text-left transition-colors hover:border-border-strong"
            >
              <FileSpreadsheet size={22} className="mb-3 text-secondary" aria-hidden />
              <span className="block text-sm font-semibold text-primary">Upload CSV</span>
              <span className="mt-1 block text-sm text-secondary">
                Best for accurate transaction history.
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("pdf");
                setStep("upload");
              }}
              className="rounded-card border border-border-subtle bg-elevated p-4 text-left transition-colors hover:border-border-strong"
            >
              <FileText size={22} className="mb-3 text-secondary" aria-hidden />
              <span className="block text-sm font-semibold text-primary">Upload statement PDF</span>
              <span className="mt-1 block text-sm text-secondary">
                Use a bank or credit-card statement when CSV export is unavailable.
              </span>
            </button>
            <p className="md:col-span-2 text-xs text-tertiary">
              PDF extraction is a fallback review workflow. Nothing from a PDF affects your
              financial record until you confirm it.
            </p>
          </div>
        </section>
      )}

      {step === "upload" && mode === "csv" && (
        <UploadStep
          accounts={accounts}
          accountId={accountId}
          onAccountChange={setAccountId}
          showAccountPicker={false}
          onReady={prepareCsv}
        />
      )}

      {step === "upload" && mode === "pdf" && (
        <PdfUploadStep
          accountId={accountId}
          accountName={selectedAccount?.displayName ?? ""}
          onReady={(review) => {
            setPdfReview(review);
            setStep("pdfReview");
          }}
        />
      )}

      {step === "map" && parsed && (
        <MapStep
          parsed={parsed}
          fileName={fileName}
          initialMapping={mapping}
          accountType={selectedAccount?.type}
          assisted={mappingSource === "assisted"}
          onBack={() => setStep("upload")}
          onConfirm={(next) => {
            setMapping(next);
            setMappingSource("manual");
            setMappingNotice("");
            setRemovedPairs(new Set());
            setEndingBalance("");
            setAnchorDate("");
            setStep("preview");
          }}
        />
      )}

      {step === "preview" && preview && (
        <PreviewStep
          preview={preview}
          accounts={accounts}
          existing={props.existing}
          removedPairs={removedPairs}
          onTogglePair={onTogglePair}
          submitting={submitting}
          submitError={submitError}
          onBack={() => setStep(mappingSource === "automatic" ? "upload" : "map")}
          mappingNotice={mappingSource === "automatic" ? mappingNotice : ""}
          onChangeMapping={() => {
            setMappingSource("manual");
            setStep("map");
          }}
          onCommit={onCommit}
          accountId={accountId}
          anchors={props.anchors}
          endingBalance={endingBalance}
          anchorDate={anchorDate}
          defaultAnchorDate={defaultAnchorDate}
          onEndingBalanceChange={setEndingBalance}
          onAnchorDateChange={setAnchorDate}
        />
      )}

      {step === "pdfReview" && pdfReview && (
        <PdfReviewStep
          review={pdfReview}
          accounts={accounts}
          existing={props.existing}
          initialAccountId={accountId}
          onCancelled={() => {
            setPdfReview(null);
            setMode(null);
            setStep("account");
          }}
          onConfirmed={(nextResult, rows, nextAccountId) => {
            setResult(nextResult);
            setSummaryRows(rows);
            setSummaryAccountId(nextAccountId);
            setStep("summary");
          }}
        />
      )}

      {step === "summary" && result && summaryRows && (
        <SummaryStep result={result} accountId={summaryAccountId} fresh={summaryRows} />
      )}
    </div>
  );
}
