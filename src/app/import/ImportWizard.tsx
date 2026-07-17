"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ColumnMapping, ExistingTxn, ParsedCsv } from "@/lib/csv-import/types";
import { UploadStep } from "./UploadStep";
import { MapStep } from "./MapStep";

// TODO(Task 13): import { PreviewStep } from "./PreviewStep";
// TODO(Task 14): import { SummaryStep } from "./SummaryStep";
// TODO(Task 13-14): wire the deterministic pipeline (normalizeRows / markDuplicates /
// detectTransfers from "@/lib/csv-import", then importTransactions from
// "@/app/actions/imports") into the preview/summary branches below, using
// `props.existing` for dedupe/transfer detection. Until then those steps render
// a "coming soon" placeholder.

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
            setStep("preview");
          }}
        />
      )}

      {(step === "preview" || step === "summary") && (
        <Card className="flex flex-col items-start gap-2 p-6">
          <p className="text-sm font-medium text-primary">{STEP_LABELS[step]} is coming soon</p>
          <p className="text-sm text-secondary">
            {parsed
              ? `“${fileName}” has ${parsed.rows.length.toLocaleString()} rows mapped — preview ships in a follow-up update.`
              : "This step isn't built yet."}
          </p>
          <button
            type="button"
            onClick={() => setStep("map")}
            className="mt-2 text-sm text-secondary hover:text-primary"
          >
            Back to column mapping
          </button>
        </Card>
      )}
    </div>
  );
}
