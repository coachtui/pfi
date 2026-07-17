"use client";

import { useMemo, useState } from "react";
import type { Category } from "@/lib/config/categories";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/config/categories";
import type { ColumnMapping, ParsedCsv } from "@/lib/csv-import/types";
import { proposeMapping } from "@/lib/csv-import/detect";
import { parseDateToken } from "@/lib/csv-import/normalize";

const MAX_CATEGORY_VALUES = 50;

const selectCls =
  "w-full rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary focus:border-border-strong focus:outline-none";
const smallSelectCls =
  "rounded-lg border border-border-subtle bg-inset px-2 py-1 text-sm text-primary focus:border-border-strong focus:outline-none";

function ColumnSelect({
  id, label, value, detected, headers, onChange, optional = false,
}: {
  id: string; label: string; value: number; detected: boolean;
  headers: string[]; onChange: (idx: number) => void; optional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-primary">
        {label}
        {detected && <span className="ml-2 text-xs font-normal text-secondary">detected from your file&apos;s headers</span>}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className={selectCls}>
        <option value={-1}>{optional ? "Not in this file" : "Choose a column…"}</option>
        {headers.map((h, i) => (
          <option key={`${i}-${h}`} value={i}>{h || `Column ${i + 1}`}</option>
        ))}
      </select>
    </div>
  );
}

export function MapStep({
  parsed, fileName, initialMapping, onBack, onConfirm,
}: {
  parsed: ParsedCsv;
  fileName: string;
  initialMapping: ColumnMapping | null;
  onBack: () => void;
  onConfirm: (mapping: ColumnMapping) => void;
}) {
  const proposal = useMemo(() => proposeMapping(parsed), [parsed]);
  const [m, setM] = useState<ColumnMapping>(initialMapping ?? proposal.mapping);
  const set = (patch: Partial<ColumnMapping>) => setM((cur) => ({ ...cur, ...patch }));

  const sampleDate = m.date !== -1 ? (parsed.rows[0]?.cells[m.date] ?? "") : "";
  const amountChosen = m.amount !== -1 || (m.debit !== -1 && m.credit !== -1);
  const ready = m.date !== -1 && m.description !== -1 && amountChosen;

  const distinctCategoryValues = useMemo(() => {
    if (m.category === -1) return [];
    const values = new Set<string>();
    for (const { cells } of parsed.rows) {
      const raw = (cells[m.category] ?? "").trim();
      if (raw !== "") values.add(raw.toLowerCase());
      if (values.size > MAX_CATEGORY_VALUES) break;
    }
    return [...values].sort();
  }, [parsed, m.category]);

  return (
    <section className="space-y-4">
      <p className="text-sm text-secondary">Tell us what each column in <span className="font-medium text-primary">{fileName}</span> means.</p>

      <ColumnSelect id="map-date" label="Date" value={m.date} detected={proposal.detected.date}
        headers={parsed.headers} onChange={(date) => set({ date })} />

      {m.date !== -1 && sampleDate !== "" && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-primary">How should dates be read?</legend>
          <p className="mb-2 text-xs text-secondary">Your file&apos;s first date is &ldquo;{sampleDate}&rdquo;.</p>
          {(["mdy", "dmy", "ymd"] as const).map((f) => {
            const iso = parseDateToken(sampleDate, f);
            return (
              <label key={f} className="mb-1 flex items-center gap-2 text-sm text-primary">
                <input type="radio" name="date-format" checked={m.dateFormat === f} onChange={() => set({ dateFormat: f })} />
                {f === "mdy" ? "Month/Day/Year" : f === "dmy" ? "Day/Month/Year" : "Year-Month-Day"}
                <span className="text-xs text-secondary">→ {iso ?? "doesn't fit this file"}</span>
              </label>
            );
          })}
        </fieldset>
      )}

      <ColumnSelect id="map-desc" label="Description" value={m.description} detected={proposal.detected.description}
        headers={parsed.headers} onChange={(description) => set({ description })} />

      <ColumnSelect id="map-amount" label="Amount (single signed column)" value={m.amount}
        detected={proposal.detected.amount && m.amount !== -1} headers={parsed.headers}
        onChange={(amount) => set({ amount, ...(amount !== -1 ? { debit: -1, credit: -1 } : {}) })} optional />

      {m.amount === -1 && (
        <div className="grid grid-cols-2 gap-3">
          <ColumnSelect id="map-debit" label="Debit (money out)" value={m.debit} detected={m.debit !== -1}
            headers={parsed.headers} onChange={(debit) => set({ debit })} />
          <ColumnSelect id="map-credit" label="Credit (money in)" value={m.credit} detected={m.credit !== -1}
            headers={parsed.headers} onChange={(credit) => set({ credit })} />
        </div>
      )}

      {m.amount !== -1 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-primary">Which sign means money in?</legend>
          <label className="mb-1 flex items-center gap-2 text-sm text-primary">
            <input type="radio" name="sign" checked={m.signConvention === "positive_inflow"} onChange={() => set({ signConvention: "positive_inflow" })} />
            Positive = money in <span className="text-xs text-secondary">(most bank accounts)</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-primary">
            <input type="radio" name="sign" checked={m.signConvention === "positive_outflow"} onChange={() => set({ signConvention: "positive_outflow" })} />
            Positive = money out <span className="text-xs text-secondary">(many credit-card exports)</span>
          </label>
        </fieldset>
      )}

      <ColumnSelect id="map-category" label="Category" value={m.category} detected={proposal.detected.category}
        headers={parsed.headers} onChange={(category) => set({ category })} optional />

      {m.category !== -1 && distinctCategoryValues.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-primary">Match your bank&apos;s categories</p>
          <p className="mb-2 text-xs text-tertiary">
            Unmatched values fall back to &ldquo;Income&rdquo; for money in and &ldquo;Other&rdquo; for money out.
            {distinctCategoryValues.length > MAX_CATEGORY_VALUES && ` Showing the first ${MAX_CATEGORY_VALUES} values.`}
          </p>
          <ul className="space-y-1">
            {distinctCategoryValues.slice(0, MAX_CATEGORY_VALUES).map((val) => (
              <li key={val} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-primary">{val}</span>
                <select
                  aria-label={`PFI category for ${val}`}
                  value={m.categoryValues[val] ?? ""}
                  onChange={(e) => {
                    const next = { ...m.categoryValues };
                    if (e.target.value === "") delete next[val];
                    else next[val] = e.target.value as Category;
                    set({ categoryValues: next });
                  }}
                  className={smallSelectCls}
                >
                  <option value="">Use default</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onBack} className="text-sm text-secondary hover:text-primary">Back</button>
        <button type="button" disabled={!ready} onClick={() => onConfirm(m)}
          className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60">
          Preview import
        </button>
      </div>
      {!ready && <p className="text-xs text-secondary">Choose a date, description, and amount column (or a debit/credit pair) to continue.</p>}
    </section>
  );
}
