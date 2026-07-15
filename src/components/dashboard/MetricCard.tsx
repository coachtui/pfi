import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

export type MetricTone = "positive" | "negative" | "warning" | "neutral";

const toneText: Record<MetricTone, string> = {
  positive: "text-positive",
  negative: "text-negative",
  warning: "text-warning",
  neutral: "text-primary",
};

const toneStroke: Record<MetricTone, string> = {
  positive: "var(--positive)",
  negative: "var(--negative)",
  warning: "var(--warning)",
  neutral: "var(--neutral)",
};

interface MetricCardProps {
  label: string;
  value: string;
  tone?: MetricTone;
  /** Recent values for the sparkline. Omit to render none. */
  trend?: number[];
  /** Screen-reader-friendly summary of the trend, since the sparkline is decorative. */
  trendDescription?: string;
  footer?: ReactNode;
}

/** Compact stat card with an optional decorative sparkline. */
export function MetricCard({
  label,
  value,
  tone = "neutral",
  trend,
  trendDescription,
  footer,
}: MetricCardProps) {
  return (
    <Card className="flex min-h-28 flex-col justify-between p-4">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${toneText[tone]}`}>{value}</p>
      {trend && trend.length > 1 && (
        <>
          <Sparkline values={trend} stroke={toneStroke[tone]} />
          {trendDescription && <span className="sr-only">{trendDescription}</span>}
        </>
      )}
      {footer}
    </Card>
  );
}

function Sparkline({ values, stroke }: { values: number[]; stroke: string }) {
  const w = 96;
  const h = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-5 w-full" aria-hidden focusable="false">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" opacity={0.9} />
    </svg>
  );
}
