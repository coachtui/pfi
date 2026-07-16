import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/chart/Sparkline";

export type MetricTone = "positive" | "negative" | "warning" | "neutral";

const toneText: Record<MetricTone, string> = {
  positive: "text-positive",
  negative: "text-negative",
  warning: "text-warning",
  neutral: "text-primary",
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
  /** When present, wraps the card in a link to a drill-down screen. */
  href?: string;
}

/** Compact stat card with an optional decorative sparkline. */
export function MetricCard({
  label,
  value,
  tone = "neutral",
  trend,
  trendDescription,
  footer,
  href,
}: MetricCardProps) {
  const card = (
    <Card
      className={`flex min-h-28 flex-col justify-between p-4 ${
        href ? "transition-colors hover:border-border-strong" : ""
      }`}
    >
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${toneText[tone]}`}>{value}</p>
      {trend && trend.length > 1 && (
        <>
          <Sparkline values={trend} tone={tone} />
          {trendDescription && <span className="sr-only">{trendDescription}</span>}
        </>
      )}
      {footer}
    </Card>
  );
  if (!href) return card;
  return (
    <Link href={href} aria-label={`${label}: ${value}. View details`} className="block rounded-card">
      {card}
    </Link>
  );
}
