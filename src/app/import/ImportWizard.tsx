"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ColumnMapping, ExistingTxn, ParsedCsv } from "@/lib/csv-import/types";
import { normalizeRows } from "@/lib/csv-import/normalize";
import { markDuplicates } from "@/lib/csv-import/dedupe";
import { detectTransfers } from "@/lib/csv-import/transfers";
import { UploadStep } from "./UploadStep";
import { MapStep } from "./MapStep";
import { PreviewStep } from "./PreviewStep";

// TODO(Task 14): import { SummaryStep } from "./SummaryStep";
// TODO(Task 14): wire importTransactions from "@/app/actions/imports" into onCommit
// below — call it with the kept fresh rows + transfer pairs, track submitting/
// submitError state, and advance to SummaryStep on success. Until then "summary"
// renders a "coming soon" placeholder and onCommit is a no-op.

type Step = "upload" | "map" | "preview" | "summary";
const STEP_LABELS: Record<Step, string> = {
  upload: "Choose file",
  map: "Map columns",
  preview: "Preview",
  summary: "Done",
};
const STEPS: Step[] = ["upload", "map", "preview", "summary"];

export function ImportWizard(props: { accounts: AccountSummary[]; existing: ExistingTxn[] }) {
  const { accounts } = props;
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [removedPairs, setRemovedPairs] = useState<Set<number>>(new Set());

  const preview = useMemo(() => {
    if (!parsed || !mapping || !accountId) return null;
    const normalized = normalizeRows(parsed, mapping);
    const { fresh, duplicates } = markDuplicates(normalized.rows, accountId, props.existing);
    const pairs = detectTransfers(fresh, accountId, props.existing);
    return { normalized, fresh, duplicates, pairs };
  }, [parsed, mapping, accountId, props.existing]);

  const onTogglePair = (line: number) => {
    setRemovedPairs((cur) => {
      const next = new Set(cur);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
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
          submitting={false}
          submitError=""
          onBack={() => setStep("map")}
          onCommit={() => {
            // TODO(Task 14): call importTransactions with preview.fresh + kept
            // transfer pairs (preview.pairs minus removedPairs) for accountId,
            // then advance to SummaryStep on success. No-op until Task 14 lands.
          }}
        />
      )}

      {step === "summary" && (
        <Card className="flex flex-col items-start gap-2 p-6">
          <p className="text-sm font-medium text-primary">{STEP_LABELS[step]} is coming soon</p>
          <p className="text-sm text-secondary">
            {parsed
              ? `“${fileName}” has ${parsed.rows.length.toLocaleString()} rows mapped — the summary step ships in a follow-up update.`
              : "This step isn't built yet."}
          </p>
          <button
            type="button"
            onClick={() => setStep("preview")}
            className="mt-2 text-sm text-secondary hover:text-primary"
          >
            Back to preview
          </button>
        </Card>
      )}
    </div>
  );
}
