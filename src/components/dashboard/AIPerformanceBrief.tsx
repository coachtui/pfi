"use client";

import { use, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { EVENT_TYPE_LABELS, formatDollars } from "@/lib/financial-engine";
import type { BriefNarrationResult } from "@/lib/data/narration";

export function AIPerformanceBrief({
  narration,
  fallback,
}: {
  narration: Promise<BriefNarrationResult | null>;
  fallback: ReactNode;
}) {
  const result = use(narration);
  if (!result) return <>{fallback}</>;
  const { output, input } = result;

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-primary">Performance brief</h2>
        <span className="rounded-full bg-neutral-muted px-2.5 py-0.5 text-[11px] font-medium text-secondary">
          AI narrative · numbers calculated
        </span>
      </div>
      <p className="text-sm leading-relaxed text-secondary">{output.body}</p>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-tertiary">
          How is this generated?
        </summary>
        <div className="mt-2 flex flex-col gap-1 text-xs text-tertiary">
          <p>
            The wording is AI-written from these verified, code-calculated metrics only —
            the AI never sees raw transactions and cannot change any number:
          </p>
          <ul className="list-disc pl-4">
            <li>Available capital {formatDollars(input.availableCapital)}; cushion {formatDollars(input.cushion)}</li>
            <li>
              {input.vsBaseline === "unknown" ? "Baseline not yet established" : `${input.vsBaseline} personal baseline`}
              {" · "}
              {input.vsWaterline} the waterline
            </li>
            <li>
              Momentum {input.momentum.direction} ({input.momentum.delta >= 0 ? "+" : ""}
              {input.momentum.delta} pts over {input.momentum.windowDays}d)
            </li>
            {input.drivers.map((d) => (
              <li key={d.id}>
                {EVENT_TYPE_LABELS[d.kind]} on {d.date}: {formatDollars(d.impact)}
                {d.buildsEquity ? " (builds equity)" : ""}
              </li>
            ))}
            {input.score && input.score.overall !== null && (
              <li>Fundamentals Score {input.score.overall} ({input.score.band})</li>
            )}
          </ul>
        </div>
      </details>
      <p className="mt-3 text-xs text-tertiary">
        Educational analysis, not financial, tax, or investment advice.
      </p>
    </Card>
  );
}
