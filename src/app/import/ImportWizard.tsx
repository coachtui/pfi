"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ColumnMapping, ExistingTxn, ParsedCsv } from "@/lib/csv-import/types";
import { normalizeRows } from "@/lib/csv-import/normalize";
import { markDuplicates } from "@/lib/csv-import/dedupe";
import { detectTransfers } from "@/lib/csv-import/transfers";
import { UploadStep } from "./UploadStep";
import { MapStep } from "./MapStep";
import { PreviewStep } from "./PreviewStep";
import { SummaryStep } from "./SummaryStep";
import { importTransactions } from "@/app/actions/imports";
import type { ImportResult } from "@/lib/validation/imports";

type Step = "upload" | "map" | "preview" | "summary";
const STEP_LABELS: Record<Step, string> = {
  upload: "Choose file",
  map: "Map columns",
  preview: "Preview",
  summary: "Done",
};
const STEPS: Step[] = ["upload", "map", "preview", "summary"];

export function ImportWizard(props: {
  accounts: AccountSummary[];
  existing: ExistingTxn[];
  // Effective anchor per account, keyed by account id.
  anchors: Record<string, { anchorDate: string; balance: number }>;
}) {
  const { accounts } = props;
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
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
    return preview.fresh.reduce((m, r) => (r.postedDate > m ? r.postedDate : m), preview.fresh[0].postedDate);
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
    setStep("summary");
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Link href="/accounts" aria-label="Back to accounts" className="rounded-lg p-1 text-secondary hover:text-primary">
          <ArrowLeft size={20} aria-hidden />
        </Link>
        <h1 className="text-lg font-semibold text-primary">Import CSV</h1>
      </div>

      <ol className="mb-6 flex gap-3 text-xs text-secondary" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? "step" : undefined}
            className={s === step ? "font-semibold text-primary" : ""}
          >
            {i + 1}. {STEP_LABELS[s]}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <UploadStep
          accounts={accounts}
          accountId={accountId}
          onAccountChange={setAccountId}
          onReady={(p, name) => {
            setParsed(p);
            setFileName(name);
            setStep("map");
          }}
        />
      )}

      {step === "map" && parsed && (
        <MapStep
          parsed={parsed}
          fileName={fileName}
          initialMapping={mapping}
          onBack={() => setStep("upload")}
          onConfirm={(next) => {
            setMapping(next);
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
          onBack={() => setStep("map")}
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

      {step === "summary" && result && preview && (
        <SummaryStep result={result} accountId={accountId} fresh={preview.fresh} />
      )}
    </div>
  );
}
