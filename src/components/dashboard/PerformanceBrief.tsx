"use client";

import { Card } from "@/components/ui/Card";
import { formatDollars, type Momentum } from "@/lib/financial-engine";

export function PerformanceBrief({
  companyName,
  momentum,
  available,
  cushionNow,
  aboveWaterline,
  aboveBaseline,
}: {
  companyName: string;
  momentum: Momentum;
  available: number;
  cushionNow: number;
  aboveWaterline: boolean;
  aboveBaseline: boolean;
}) {
  const momentumPhrase =
    momentum.direction === "improving"
      ? "momentum is positive"
      : momentum.direction === "declining"
        ? "momentum has softened"
        : "momentum is steady";
  const baselinePhrase = aboveBaseline
    ? "trading above its personal baseline"
    : "currently below its personal baseline";
  const waterlinePhrase = aboveWaterline
    ? `holding ${formatDollars(cushionNow)} of cushion above the waterline`
    : "below its financial waterline — near-term essentials exceed available capital";

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-primary">Performance brief</h2>
        <span className="rounded-full bg-neutral-muted px-2.5 py-0.5 text-[11px] font-medium text-secondary">
          Calculated
        </span>
      </div>
      <p className="text-sm leading-relaxed text-secondary">
        {companyName} is {baselinePhrase} and {momentumPhrase}. Available capital stands at{" "}
        {formatDollars(available)}, {waterlinePhrase}.
      </p>
      <p className="mt-3 text-xs text-tertiary">
        Educational analysis, not financial, tax, or investment advice.
      </p>
    </Card>
  );
}
