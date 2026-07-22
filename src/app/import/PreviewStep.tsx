"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, CopyX, Settings2 } from "lucide-react";
import { InlineError } from "@/components/ui/InlineError";
import type { AccountSummary } from "@/lib/data/mappers";
import type {
  ExistingTxn,
  NormalizedRow,
  ParseError,
  RowError,
  TransferPair,
} from "@/lib/csv-import/types";
import { CATEGORY_LABELS } from "@/lib/config/categories";
import {
  computeDiscrepancy,
  type AccountInput,
  type TransactionInput,
} from "@/lib/financial-engine";
import { formatDollars } from "@/lib/financial-engine/format";

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
      <span className="min-w-0">
        <span className="block truncate text-primary">
          {r.postedDate} · {r.description}
        </span>
        <span className="block text-xs text-secondary">{CATEGORY_LABELS[r.category]}</span>
      </span>
      <span className="shrink-0 tabular-nums text-primary">
        {r.direction === "inflow" ? "+" : "−"}
        {money(r.amount)}
      </span>
    </li>
  );
}

function Chip({
  icon,
  label,
  count,
  open,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
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
  preview,
  accounts,
  existing,
  removedPairs,
  onTogglePair,
  submitting,
  submitError,
  onBack,
  onCommit,
  accountId,
  anchors,
  endingBalance,
  anchorDate,
  defaultAnchorDate,
  onEndingBalanceChange,
  onAnchorDateChange,
  mappingNotice,
  onChangeMapping,
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
  accountId: string;
  anchors: Record<string, { anchorDate: string; balance: number }>;
  endingBalance: string;
  anchorDate: string;
  defaultAnchorDate: string;
  onEndingBalanceChange: (v: string) => void;
  onAnchorDateChange: (v: string) => void;
  mappingNotice: string;
  onChangeMapping: () => void;
}) {
  const [openSection, setOpenSection] = useState<"" | "new" | "dup" | "transfer" | "error">("");
  const toggle = (s: typeof openSection) => setOpenSection((cur) => (cur === s ? "" : s));
  const { fresh, duplicates, pairs, errors } = preview;
  const rowByLine = new Map(fresh.map((r) => [r.line, r]));
  const existingById = new Map(existing.map((t) => [t.id, t]));
  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.displayName ?? "another account";
  const keptPairCount = pairs.filter((p) => !removedPairs.has(p.line)).length;

  const account = accounts.find((a) => a.id === accountId);
  const priorAnchor = anchors[accountId] ?? null;
  const effAnchorDate = anchorDate || defaultAnchorDate;
  const recon = useMemo(() => {
    const n = Number(endingBalance.trim());
    if (endingBalance.trim() === "" || !Number.isFinite(n) || !account || !effAnchorDate)
      return null;
    const acctForMath: AccountInput = {
      id: accountId,
      type: account.type,
      currentBalance: 0,
      includeInCalculations: true,
    };
    const mathTxns: TransactionInput[] = [
      ...existing
        .filter((t) => t.accountId === accountId)
        .map((t) => ({
          id: t.id,
          accountId: t.accountId,
          postedDate: t.postedDate,
          amount: t.amount,
          direction: t.direction,
          description: t.description,
          category: null,
          essential: null,
          isTransfer: t.isTransfer,
          transferPairId: t.transferPairId,
        })),
      ...preview.fresh.map((r) => ({
        id: `line-${r.line}`,
        accountId,
        postedDate: r.postedDate,
        amount: r.amount,
        direction: r.direction,
        description: r.description,
        category: null,
        essential: null,
        isTransfer: false,
        transferPairId: null,
      })),
    ];
    return {
      discrepancy: computeDiscrepancy(acctForMath, priorAnchor, n, effAnchorDate, mathTxns),
    };
  }, [endingBalance, effAnchorDate, account, accountId, existing, preview.fresh, priorAnchor]);

  return (
    <section className="space-y-4">
      {mappingNotice && (
        <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-elevated p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <CheckCircle2 size={16} aria-hidden /> PFI mapped this file automatically
            </p>
            <p className="mt-1 text-xs text-secondary">
              {mappingNotice} Review money in and money out below before importing.
            </p>
          </div>
          <button
            type="button"
            onClick={onChangeMapping}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs text-secondary hover:text-primary"
          >
            <Settings2 size={14} aria-hidden /> Change mapping
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Chip
          icon={<CheckCircle2 size={14} aria-hidden />}
          label="new"
          count={fresh.length}
          open={openSection === "new"}
          onToggle={() => toggle("new")}
        />
        <Chip
          icon={<CopyX size={14} aria-hidden />}
          label="duplicates skipped"
          count={duplicates.length}
          open={openSection === "dup"}
          onToggle={() => toggle("dup")}
        />
        <Chip
          icon={<ArrowLeftRight size={14} aria-hidden />}
          label="transfer pairs"
          count={pairs.length}
          open={openSection === "transfer"}
          onToggle={() => toggle("transfer")}
        />
        <Chip
          icon={<AlertTriangle size={14} aria-hidden />}
          label="rows with errors"
          count={errors.length}
          open={openSection === "error"}
          onToggle={() => toggle("error")}
        />
      </div>

      {openSection === "new" && (
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border-subtle bg-inset p-3">
          {fresh.map((r) => (
            <RowLine key={r.line} r={r} />
          ))}
          {fresh.length === 0 && <li className="text-sm text-secondary">No new rows.</li>}
        </ul>
      )}

      {openSection === "dup" && (
        <div className="rounded-xl border border-border-subtle bg-inset p-3">
          <p className="mb-2 text-xs text-secondary">
            Why skipped? An identical transaction (same date, amount, direction, and description)
            already exists in this account — usually from an earlier export of an overlapping date
            range.
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {duplicates.map((r) => (
              <RowLine key={r.line} r={r} />
            ))}
            {duplicates.length === 0 && (
              <li className="text-sm text-secondary">No duplicates found.</li>
            )}
          </ul>
        </div>
      )}

      {openSection === "transfer" && (
        <div className="rounded-xl border border-border-subtle bg-inset p-3">
          <p className="mb-2 text-xs text-secondary">
            Why a transfer? An opposite transaction with the same amount exists within 3 days on
            another of your accounts. Transfers don&apos;t count as income or spending. Un-check any
            that are wrong.
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
                      matches {other.postedDate} &ldquo;{other.description}&rdquo; on{" "}
                      {accountName(other.accountId)}
                    </span>
                  </label>
                </li>
              );
            })}
            {pairs.length === 0 && (
              <li className="text-sm text-secondary">No transfers detected.</li>
            )}
          </ul>
        </div>
      )}

      {openSection === "error" && (
        <div className="rounded-xl border border-border-subtle bg-inset p-3">
          <p className="mb-2 text-xs text-secondary">
            These rows couldn&apos;t be read and will not be imported. Fix them in the file and
            re-import, or continue without them.
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {errors.map((e) => (
              <li key={e.line} className="text-sm text-warning">
                Line {e.line}: {e.message}
              </li>
            ))}
            {errors.length === 0 && <li className="text-sm text-secondary">No errors.</li>}
          </ul>
        </div>
      )}

      <section
        aria-labelledby="anchor-heading"
        className="rounded-card border border-border-subtle bg-elevated p-3"
      >
        <h3 id="anchor-heading" className="text-sm font-medium text-primary">
          Statement ending balance
        </h3>
        <p className="mt-1 text-xs text-secondary">
          Printed on your statement — &ldquo;new balance&rdquo; on credit cards (enter the amount
          owed as a positive number). This anchors the account&apos;s balance so your score stays
          accurate. Optional — skip it and the balance stays as of{" "}
          {priorAnchor ? priorAnchor.anchorDate : "its last manual entry"}.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="anchor-balance" className="mb-1 block text-xs font-medium text-primary">
              Ending balance ($)
            </label>
            <input
              id="anchor-balance"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={endingBalance}
              onChange={(e) => onEndingBalanceChange(e.target.value)}
              className="w-40 rounded-xl border border-border-subtle bg-inset px-3 py-2 text-sm text-primary"
            />
          </div>
          <div>
            <label htmlFor="anchor-date" className="mb-1 block text-xs font-medium text-primary">
              As of
            </label>
            <input
              id="anchor-date"
              type="date"
              value={effAnchorDate}
              onChange={(e) => onAnchorDateChange(e.target.value)}
              className="rounded-xl border border-border-subtle bg-inset px-3 py-2 text-sm text-primary"
            />
          </div>
        </div>
        {recon && (
          <p role="status" className="mt-2 text-xs text-secondary">
            {recon.discrepancy === null
              ? "First anchor for this account — nothing to reconcile against yet."
              : recon.discrepancy === 0
                ? "✓ Reconciles cleanly with your existing data."
                : `⚠ ${formatDollars(Math.abs(recon.discrepancy))} unaccounted for between ${priorAnchor?.anchorDate} and ${effAnchorDate} — some transactions may be missing from this period. You can still import; the difference is recorded.`}
          </p>
        )}
      </section>

      {submitError && (
        <div className="space-y-2">
          <InlineError message={submitError} />
          <p className="text-xs text-tertiary">Your preview is unchanged; you can retry.</p>
        </div>
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
