"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import type { NormalizedRow } from "@/lib/csv-import/types";
import { CATEGORY_LABELS, type Category } from "@/lib/config/categories";
import { undoImport } from "@/app/actions/imports";
import type { ImportResult } from "@/lib/validation/imports";

export function SummaryStep({
  result, accountId, fresh,
}: {
  result: ImportResult;
  accountId: string;
  fresh: NormalizedRow[];
}) {
  const router = useRouter();
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState("");
  const [undoWarning, setUndoWarning] = useState("");

  const byCategory = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const r of fresh) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [fresh]);
  const dates = fresh.map((r) => r.postedDate).sort();
  const from = dates[0] ?? "";
  const to = dates[dates.length - 1] ?? "";

  async function handleUndo() {
    if (!result.batchId || undoing) return;
    setUndoing(true);
    setUndoError("");
    const res = await undoImport(result.batchId);
    setUndoing(false);
    if (res.error) setUndoError(res.error);
    else { setUndoWarning(res.warning ?? ""); setUndone(true); router.refresh(); }
  }

  if (undone) {
    return (
      <section className="space-y-3 text-center">
        <p className="text-sm text-primary">
          {undoWarning
            ? "Import undone — those transactions were removed."
            : "Import undone — those transactions were removed and your index was recalculated."}
        </p>
        {undoWarning && <p role="status" className="text-sm text-warning">⚠ {undoWarning}</p>}
        <Link href="/accounts" className="text-sm text-secondary hover:text-primary">Back to accounts</Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <p className="inline-flex items-center gap-2 text-sm font-medium text-primary">
        <CheckCircle2 size={18} aria-hidden />
        Imported {result.imported ?? 0} transaction{(result.imported ?? 0) === 1 ? "" : "s"}
        {result.skippedDuplicates ? ` · ${result.skippedDuplicates} duplicates skipped` : ""}
      </p>
      {result.warning && <p role="status" className="text-sm text-warning">⚠ {result.warning}</p>}

      {byCategory.length > 0 && (
        <ul className="rounded-xl border border-border-subtle bg-inset p-3 text-sm text-primary">
          {byCategory.map(([cat, n]) => (
            <li key={cat} className="flex justify-between">
              <span>{CATEGORY_LABELS[cat]}</span>
              <span className="tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Link
          href={`/transactions?account=${accountId}${from ? `&from=${from}&to=${to}` : ""}`}
          className="rounded-xl bg-positive-strong px-4 py-3 text-center text-sm font-semibold text-base"
        >
          See them in Transactions
        </Link>
        <Link
          href="/score"
          className="rounded-xl border border-border-subtle px-4 py-3 text-center text-sm text-primary"
        >
          How this changed your score
        </Link>

        {confirmingUndo ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoing}
              className="flex-1 rounded-xl border border-negative px-4 py-3 text-sm font-semibold text-negative disabled:opacity-60"
            >
              {undoing ? "Undoing…" : "Confirm undo — can't be undone"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingUndo(false)}
              disabled={undoing}
              className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary hover:text-primary disabled:opacity-60"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingUndo(true)}
            className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary hover:text-primary"
          >
            Undo this import
          </button>
        )}
        {undoError && <p role="alert" className="text-sm text-negative">✕ {undoError}</p>}
      </div>
    </section>
  );
}
