import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { momentumLabel, type MomentumState } from "@/lib/financial-engine";
import type { ScoreSummary } from "@/lib/data/queries";

const MOMENTUM_GLYPH: Record<MomentumState, string> = {
  strongly_improving: "▲▲",
  improving: "▲",
  recovering: "▲",
  stable: "—",
  weakening: "▼",
  deteriorating: "▼▼",
  insufficient_history: "…",
};

const chipCls = "rounded-full border border-border-subtle px-2 py-0.5 text-xs text-secondary";

/** Dashboard entry point into the Fundamentals Score. Not a credit score. */
export function ScoreCard({ summary }: { summary: ScoreSummary }) {
  const label =
    summary.state === "suppressed"
      ? `Fundamentals Score: add data to unlock, momentum ${momentumLabel(summary.momentum)}. View details`
      : `Fundamentals Score: ${summary.overall} out of 900, ${summary.band}${
          summary.state === "provisional" ? ", provisional" : ""
        }, momentum ${momentumLabel(summary.momentum)}. View details`;

  return (
    <Link href="/score" aria-label={label} className="block rounded-card">
      <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-border-strong">
        <div>
          <p className="text-xs font-medium text-secondary">Fundamentals Score</p>
          {summary.state === "suppressed" ? (
            <p className="mt-1 text-sm font-medium text-primary">Add data to unlock</p>
          ) : (
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="tabular text-2xl font-semibold text-primary">{summary.overall}</span>
              <span className="text-xs text-secondary">/ 900 · {summary.band}</span>
              {summary.state === "provisional" && (
                <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-xs text-secondary">
                  Provisional
                </span>
              )}
            </div>
          )}
        </div>
        <span className={chipCls}>
          {MOMENTUM_GLYPH[summary.momentum]} {momentumLabel(summary.momentum)}
        </span>
      </Card>
    </Link>
  );
}
