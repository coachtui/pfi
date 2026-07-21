import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/chart/Sparkline";
import { FinancialTerm } from "@/components/concepts/FinancialTerm";
import type { ConceptId } from "@/lib/concepts";

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
  /** When set, the label becomes a tappable FinancialTerm. */
  conceptId?: ConceptId;
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
  conceptId,
}: MetricCardProps) {
  const inner = (
    <>
      <p className="text-[11px] leading-tight font-medium text-secondary sm:text-xs">
        {conceptId ? <FinancialTerm conceptId={conceptId}>{label}</FinancialTerm> : label}
      </p>
      <p className={`tabular mt-1 text-base font-semibold sm:text-xl ${toneText[tone]}`}>{value}</p>
      {trend && trend.length > 1 && (
        <>
          <Sparkline values={trend} tone={tone} />
          {trendDescription && <span className="sr-only">{trendDescription}</span>}
        </>
      )}
      {footer}
    </>
  );

  const cardClass = "flex min-h-24 flex-col justify-between p-2.5 sm:min-h-28 sm:p-4";

  // A card carrying a tappable term must not live inside a link (<a> may not
  // contain interactive content): the drill-down becomes an explicit sibling
  // link instead of a whole-card wrap. KNOWN_LIMITATIONS 2026-07-20, resolved
  // by Academy Slice 3.
  if (href && conceptId) {
    return (
      <Card className={cardClass}>
        {inner}
        <Link
          href={href}
          aria-label={`${label}: ${value}. View details`}
          className="mt-1 self-start text-[11px] text-secondary underline-offset-2 hover:text-primary hover:underline sm:text-xs"
        >
          View details
        </Link>
      </Card>
    );
  }

  const card = (
    <Card className={`${cardClass} ${href ? "transition-colors hover:border-border-strong" : ""}`}>
      {inner}
    </Card>
  );
  if (!href) return card;
  return (
    <Link href={href} aria-label={`${label}: ${value}. View details`} className="block rounded-card">
      {card}
    </Link>
  );
}
