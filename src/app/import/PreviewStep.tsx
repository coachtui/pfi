"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, CopyX } from "lucide-react";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ExistingTxn, NormalizedRow, ParseError, RowError, TransferPair } from "@/lib/csv-import/types";

interface Preview {
  fresh: NormalizedRow[];
  duplicates: NormalizedRow[];
  pairs: TransferPair[];
  /** Pre-mapping parse errors and post-mapping normalize errors, combined —
   * every row excluded from `fresh`/`duplicates` for a data reason shows up here. */
  errors: Array<ParseError | RowError>;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function RowLine({ r }: { r: NormalizedRow }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-sm">
      <span className="truncate text-primary">{r.postedDate} · {r.description}</span>
      <span className="shrink-0 tabular-nums text-primary">
        {r.direction === "inflow" ? "+" : "−"}{money(r.amount)}
      </span>
    </li>
  );
}

function Chip({
  icon, label, count, open, onToggle,
}: {
  icon: React.ReactNode; label: string; count: number; open: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-3 py-1 text-sm text-primary"
    >
      {icon} {count} {label}
    </button>
  );
}

export function PreviewStep({
  preview, accounts, existing, removedPairs, onTogglePair, submitting, submitError, onBack, onCommit,
}: {
  preview: Preview;
  accounts: AccountSummary[];
  existing: ExistingTxn[];
  removedPairs: ReadonlySet<number>;
  onTogglePair: (line: number) => void;
  submitting: boolean;
  submitError: string;
  onBack: () => void;
  onCommit: () => void;
}) {
  const [openSection, setOpenSection] = useState<"" | "new" | "dup" | "transfer" | "error">("");
  const toggle = (s: typeof openSection) => setOpenSection((cur) => (cur === s ? "" : s));
  const { fresh, duplicates, pairs, errors } = preview;
  const rowByLine = new Map(fresh.map((r) => [r.line, r]));
  const existingById = new Map(existing.map((t) => [t.id, t]));
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.displayName ?? "another account";
  const keptPairCount = pairs.filter((p) => !removedPairs.has(p.line)).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Chip icon={<CheckCircle2 size={14} aria-hidden />} label="new" count={fresh.length} open={openSection === "new"} onToggle={() => toggle("new")} />
        <Chip icon={<CopyX size={14} aria-hidden />} label="duplicates skipped" count={duplicates.length} open={openSection === "dup"} onToggle={() => toggle("dup")} />
        <Chip icon={<ArrowLeftRight size={14} aria-hidden />} label="transfer pairs" count={pairs.length} open={openSection === "transfer"} onToggle={() => toggle("transfer")} />
        <Chip icon={<AlertTriangle size={14} aria-hidden />} label="rows with errors" count={errors.length} open={openSection === "error"} onToggle={() => toggle("error")} />
      </div>

      {openSection === "new" && (
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border-subtle bg-inset p-3">
          {fresh.map((r) => <RowLine key={r.line} r={r} />)}
          {fresh.length === 0 && <li className="text-sm text-secondary">No new rows.</li>}
        </ul>
      )}

      {openSection === "dup" && (
        <div className="rounded-xl border border-border-subtle bg-inset p-3">
          <p className="mb-2 text-xs text-secondary">
            Why skipped? An identical transaction (same date, amount, direction, and description) already
            exists in this account — usually from an earlier export of an overlapping date range.
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {duplicates.map((r) => <RowLine key={r.line} r={r} />)}
            {duplicates.length === 0 && <li className="text-sm text-secondary">No duplicates found.</li>}
          </ul>
        </div>
      )}

      {openSection === "transfer" && (
        <div className="rounded-xl border border-border-subtle bg-inset p-3">
          <p className="mb-2 text-xs text-secondary">
            Why a transfer? An opposite transaction with the same amount exists within 3 days on another
            of your accounts. Transfers don&apos;t count as income or spending. Un-check any that are wrong.
          </p>
          <ul className="space-y-2">
            {pairs.map((p) => {
              const row = rowByLine.get(p.line);
              const other = existingById.get(p.existingId);
              if (!row || !other) return null;
              return (
                <li key={p.line} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    id={`pair-${p.line}`}
                    checked={!removedPairs.has(p.line)}
                    onChange={() => onTogglePair(p.line)}
                    className="mt-1"
                  />
                  <label htmlFor={`pair-${p.line}`} className="text-primary">
                    {row.postedDate} · {row.description} · {money(row.amount)}
                    <span className="block text-xs text-secondary">
                      matches {other.postedDate} &ldquo;{other.description}&rdquo; on {accountName(other.accountId)}
                    </span>
                  </label>
                </li>
              );
            })}
            {pairs.length === 0 && <li className="text-sm text-secondary">No transfers detected.</li>}
          </ul>
        </div>
      )}

      {openSection === "error" && (
        <div className="rounded-xl border border-border-subtle bg-inset p-3">
          <p className="mb-2 text-xs text-secondary">
            These rows couldn&apos;t be read and will not be imported. Fix them in the file and re-import,
            or continue without them.
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {errors.map((e) => (
              <li key={e.line} className="text-sm text-warning">Line {e.line}: {e.message}</li>
            ))}
            {errors.length === 0 && <li className="text-sm text-secondary">No errors.</li>}
          </ul>
        </div>
      )}

      {submitError && (
        <p role="alert" className="text-sm text-negative">✕ {submitError} — your preview is unchanged; you can retry.</p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-primary disabled:opacity-60"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={submitting || fresh.length === 0}
          className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
        >
          {submitting
            ? "Importing…"
            : fresh.length === 0
              ? "Nothing new to import"
              : `Import ${fresh.length} transaction${fresh.length === 1 ? "" : "s"}${keptPairCount > 0 ? ` (${keptPairCount} as transfers)` : ""}`}
        </button>
      </div>
    </section>
  );
}
