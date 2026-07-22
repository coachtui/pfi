"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RecentImport } from "@/lib/data/mappers";
import { undoImport } from "@/app/actions/imports";
import { InlineError } from "@/components/ui/InlineError";

const keepCls =
  "rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60";
const confirmCls =
  "rounded-lg border border-negative px-2.5 py-1 text-xs font-semibold text-negative transition-colors disabled:opacity-60";

/** Derived, per-batch summary of imported transactions with a two-step undo
 * (mirrors the confirm pattern in TransactionSheet's delete and SummaryStep's
 * undo — secondary style, then a bordered danger style on confirm). */
export function RecentImports({ imports }: { imports: RecentImport[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  if (imports.length === 0) return null;

  async function handleUndo(batchId: string) {
    setBusy(batchId);
    setError("");
    setWarning("");
    const res = await undoImport(batchId);
    setBusy(null);
    setConfirming(null);
    if (res.error) setError(res.error);
    else {
      if (res.warning) setWarning(res.warning);
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="recent-imports-heading" className="mt-6">
      <h2 id="recent-imports-heading" className="mb-2 text-sm font-semibold text-primary">
        Recent imports
      </h2>
      <p className="mb-2 text-xs text-secondary">
        Imported transactions are corrected, not deleted — but a whole import can be undone here.
      </p>
      {error && <div className="mb-2"><InlineError message={error} /></div>}
      {warning && <p role="status" className="mb-2 text-sm text-warning">⚠ {warning}</p>}
      <ul className="flex flex-col gap-2">
        {imports.map((imp) => (
          <li
            key={imp.batchId}
            className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate text-primary">
                {imp.accountName} · {imp.rowCount} transaction{imp.rowCount === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-secondary">
                {imp.firstDate} → {imp.lastDate} · imported {imp.importedAt.slice(0, 10)}
              </p>
            </div>
            {confirming === imp.batchId ? (
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy === imp.batchId}
                  onClick={() => handleUndo(imp.batchId)}
                  className={confirmCls}
                >
                  {busy === imp.batchId ? "Undoing…" : "Confirm undo"}
                </button>
                <button
                  type="button"
                  disabled={busy === imp.batchId}
                  onClick={() => setConfirming(null)}
                  className={keepCls}
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(imp.batchId)}
                className={`shrink-0 ${keepCls}`}
              >
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
