import { clampPercent, formatOrdinal } from "@/lib/ui/math";

/** Horizontal percentile bar with a 50th-percentile tick. Meaning is always
 * duplicated in adjacent text — the bar itself is decorative reinforcement. */
export function PercentileBar({
  percentile,
  goodDirection,
}: {
  percentile: number;
  goodDirection: boolean;
}) {
  const pct = clampPercent(percentile);
  const barColor = goodDirection ? "bg-positive" : "bg-negative";
  return (
    <div
      role="img"
      aria-label={`${formatOrdinal(pct)} percentile`}
      className="relative h-1.5 w-full rounded-full bg-elevated-2"
    >
      <div className={`absolute inset-y-0 left-0 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      <div aria-hidden className="absolute top-1/2 left-1/2 h-3 w-px -translate-y-1/2 border-l border-dashed border-border-strong" />
    </div>
  );
}
