import type { FormulaRow } from "@/lib/concepts";

/**
 * Statement-style visual calculation. The visual layout is aria-hidden;
 * `fallbackText` (the concept's plain `formula` string) is the screen-reader
 * text, so the block is accessible without parsing the row grid.
 */
export function FormulaBlock({
  rows,
  fallbackText,
  values,
  showValues = true,
}: {
  rows: FormulaRow[];
  fallbackText: string;
  /** Resolved live values keyed by FormulaRow.valueKey. */
  values?: Record<string, string>;
  /** false = structure only (the definition sheet hides sample staticValues). */
  showValues?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-inset p-3">
      <p className="sr-only">{fallbackText}</p>
      <div aria-hidden className="flex flex-col font-mono text-sm">
        {rows.map((row, i) => {
          const isTotal = row.operator === "=";
          const value = showValues ? ((row.valueKey && values?.[row.valueKey]) ?? row.staticValue) : undefined;
          return (
            <div
              key={i}
              className={`flex items-baseline justify-between gap-3 py-0.5 ${
                isTotal ? "mt-1 border-t border-border-strong pt-1.5 font-semibold text-primary" : "text-secondary"
              }`}
            >
              <span>
                {row.operator === "-" ? "− " : row.operator === "+" ? "+ " : ""}
                {row.label}
              </span>
              {value !== undefined && <span className="tabular">{value}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
