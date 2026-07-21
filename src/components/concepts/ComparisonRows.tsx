import { Check, X } from "lucide-react";
import type { ComparisonRow } from "@/lib/concepts";

/** Responsive included/excluded list — stacked rows, never a wide table (spec §Section 2). */
export function ComparisonRows({ rows }: { rows: ComparisonRow[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-inset p-2.5">
          {row.included ? (
            <span className="flex w-16 shrink-0 items-center gap-1 text-[11px] font-medium text-positive">
              <Check size={12} aria-hidden /> Counts
            </span>
          ) : (
            <span className="flex w-16 shrink-0 items-center gap-1 text-[11px] font-medium text-tertiary">
              <X size={12} aria-hidden /> Doesn&apos;t
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-primary">{row.label}</span>
            {row.explanation && <span className="text-xs text-secondary">{row.explanation}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
