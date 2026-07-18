"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, ArrowRight, ArrowDownRight, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { FinancialChart, type ChartMarker, type StemMarker } from "@/components/chart/FinancialChart";
import { CompanyHeader } from "@/components/dashboard/CompanyHeader";
import { MetricCard, type MetricTone } from "@/components/dashboard/MetricCard";
import { ScoreCard } from "@/components/dashboard/ScoreCard";
import { Segmented } from "@/components/ui/Segmented";
import { WhatMovedYourLine } from "@/components/dashboard/WhatMovedYourLine";
import type { ScoreSummary } from "@/lib/data/queries";
import {
  availablePosition,
  buildIndexSeries,
  computeDrivers,
  computeMomentum,
  cushion,
  formatDollars,
  formatSignedPercent,
  waterline,
  type DailySnapshot,
  type FinancialEvent,
  type Momentum,
} from "@/lib/financial-engine";
const RANGES = [
  { key: "30D", days: 30 },
  { key: "90D", days: 90 },
  { key: "1Y", days: 365 },
  { key: "All", days: Infinity },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

/** Event types worth a chart marker, in priority order when thinning. */
const MARKER_PRIORITY: FinancialEvent["type"][] = [
  "bonus",
  "large_purchase",
  "mortgage_payment",
  "paycheck",
];
const MAX_MARKERS = 8;

const STEM_TYPES: FinancialEvent["type"][] = ["paycheck", "mortgage_payment", "bonus"];
const STEM_MAX_RANGE_DAYS = 45;

export interface DashboardIdentity {
  companyName: string;
  ticker: string;
  username: string;
  level?: number;
}

interface HomeDashboardProps {
  profile: DashboardIdentity;
  snapshots: DailySnapshot[];
  events: FinancialEvent[];
  scoreSummary: ScoreSummary;
  /** True when a snapshot rebuild is pending/failed and the chart may lag recent edits. */
  staleIndex?: boolean;
}

export function HomeDashboard({ profile, snapshots, events, scoreSummary, staleIndex }: HomeDashboardProps) {
  const [range, setRange] = useState<RangeKey>("30D");

  // The index is anchored on full history once; ranges only slice the view.
  const { points } = useMemo(() => buildIndexSeries(snapshots), [snapshots]);

  const view = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    const visible = days === Infinity ? points : points.slice(-days);
    const start = visible[0].date;
    const end = visible[visible.length - 1].date;

    const drivers = computeDrivers(events, { start, end });
    const markers = selectMarkers(events, visible);
    const stems = selectStems(events, visible);
    return { visible, drivers, markers, stems, start, end };
  }, [points, events, range]);

  const latest = snapshots[snapshots.length - 1];
  const latestPoint = points[points.length - 1];
  const prevPoint = points[points.length - 2];
  const todayChangePct =
    prevPoint && prevPoint.actual !== 0
      ? ((latestPoint.actual - prevPoint.actual) / Math.abs(prevPoint.actual)) * 100
      : 0;

  const momentum = useMemo(() => computeMomentum(points.map((p) => p.actual)), [points]);

  const trendOf = (fn: (s: DailySnapshot) => number) => snapshots.slice(-14).map(fn);
  const availableNow = availablePosition(latest);
  const cushionNow = cushion(latest);

  return (
    <div className="flex flex-col gap-4">
      <CompanyHeader
        companyName={profile.companyName}
        ticker={profile.ticker}
        username={profile.username}
        level={profile.level}
      />

      {/* Personal index + chart */}
      <Card className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-secondary">
              Personal Index
              <Info size={14} aria-label="Indexed to 100 at your starting financial position" />
            </p>
            <p className="tabular mt-1 text-4xl font-semibold text-primary">
              {latestPoint.actual.toFixed(1)}
            </p>
            <p className="mt-1 text-sm">
              <span
                className={`tabular font-medium ${todayChangePct >= 0 ? "text-positive" : "text-negative"}`}
              >
                {formatSignedPercent(todayChangePct)}
              </span>{" "}
              <span className="text-tertiary">Today</span>
            </p>
          </div>
          <Segmented
            options={RANGES.map((r) => ({ key: r.key, label: r.key }))}
            value={range}
            onChange={(key) => setRange(key as RangeKey)}
            ariaLabel="Chart time range"
          />
        </div>
        <div className="mt-2">
          <FinancialChart
            points={view.visible}
            markers={view.markers}
            stems={view.stems}
            ariaDescription={`Personal financial index over the selected ${range} range. Current value ${latestPoint.actual.toFixed(1)}, baseline ${latestPoint.baseline?.toFixed(1) ?? "n/a"}, waterline ${latestPoint.waterline.toFixed(1)}.`}
          />
        </div>
      </Card>

      {staleIndex && (
        <p role="status" className="rounded-card border border-border-subtle bg-elevated p-3 text-sm text-warning">
          ⚠ Index recalculation pending — recent data changes aren’t reflected in the chart yet. They’ll be picked up automatically.
        </p>
      )}

      <ScoreCard summary={scoreSummary} />

      {/* Key metrics */}
      <section aria-label="Key metrics" className="grid grid-cols-4 gap-2 md:gap-3">
        <MetricCard
          label="Available Capital"
          value={formatDollars(availableNow)}
          tone="neutral"
          trend={trendOf(availablePosition)}
          trendDescription="Available capital over the last 14 days"
          href="/accounts"
        />
        <MetricCard
          label="Obligations"
          value={formatDollars(latest.nearTermObligations)}
          tone="neutral"
          trend={trendOf((s) => -s.nearTermObligations)}
          trendDescription="Near-term obligations over the last 14 days"
        />
        <MetricCard
          label="Cushion"
          value={formatDollars(cushionNow)}
          tone={cushionNow >= 0 ? "positive" : "negative"}
          trend={trendOf(cushion)}
          trendDescription="Cushion above your waterline over the last 14 days"
        />
        <MomentumCard momentum={momentum} />
      </section>

      {/* Drivers */}
      <section aria-labelledby="what-moved">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="what-moved" className="text-base font-semibold text-primary">
            What moved your line
          </h2>
          <span className="text-xs text-tertiary">Largest events · {range}</span>
        </div>
        <WhatMovedYourLine drivers={view.drivers} />
      </section>

      {/* Deterministic summary (AI narration replaces the wording, never the numbers, in Phase 4) */}
      <PerformanceBrief
        companyName={profile.companyName}
        momentum={momentum}
        available={availableNow}
        cushionNow={cushionNow}
        aboveWaterline={availableNow > waterline(latest)}
        aboveBaseline={latestPoint.baseline !== null && latestPoint.actual > latestPoint.baseline}
      />
    </div>
  );
}

function selectMarkers(
  events: FinancialEvent[],
  visible: { date: string; actual: number }[],
): ChartMarker[] {
  const byDate = new Map(visible.map((p) => [p.date, p.actual]));
  const inRange = events.filter((e) => byDate.has(e.date));
  const chosen: FinancialEvent[] = [];
  for (const type of MARKER_PRIORITY) {
    for (const e of inRange) {
      if (e.type === type && chosen.length < MAX_MARKERS) chosen.push(e);
    }
    if (chosen.length >= MAX_MARKERS) break;
  }
  return chosen.map((event) => ({ event, y: byDate.get(event.date)! }));
}

function selectStems(
  events: FinancialEvent[],
  visible: { date: string }[],
): StemMarker[] {
  if (visible.length === 0 || visible.length > STEM_MAX_RANGE_DAYS) return [];
  const indexByDate = new Map(visible.map((p, i) => [p.date, i]));
  const stems: StemMarker[] = [];
  for (const type of STEM_TYPES) {
    // most recent event of each type within the visible window
    const match = [...events].reverse().find((e) => e.type === type && indexByDate.has(e.date));
    if (match) stems.push({ event: match, pointIndex: indexByDate.get(match.date)! });
  }
  return stems.sort((a, b) => a.pointIndex - b.pointIndex);
}

function MomentumBars({ direction }: { direction: Momentum["direction"] }) {
  const heights = direction === "improving" ? [5, 8, 11, 14] : direction === "declining" ? [14, 11, 8, 5] : [9, 9, 9, 9];
  const fill = direction === "improving" ? "var(--positive)" : direction === "declining" ? "var(--warning)" : "var(--neutral)";
  return (
    <svg viewBox="0 0 30 16" className="h-3.5 w-7 shrink-0" aria-hidden focusable="false">
      {heights.map((h, i) => (
        <rect key={i} x={i * 8} y={16 - h} width={5} height={h} rx={1.5} fill={fill} opacity={0.4 + i * 0.2} />
      ))}
    </svg>
  );
}

function MomentumCard({ momentum }: { momentum: Momentum }) {
  const config: Record<
    Momentum["direction"],
    { label: string; tone: MetricTone; icon: typeof ArrowUpRight }
  > = {
    improving: { label: "Improving", tone: "positive", icon: ArrowUpRight },
    stable: { label: "Stable", tone: "neutral", icon: ArrowRight },
    declining: { label: "Declining", tone: "warning", icon: ArrowDownRight },
  };
  const { label, tone, icon: Icon } = config[momentum.direction];
  return (
    <MetricCard
      label="Momentum"
      value={label}
      tone={tone}
      footer={
        <p className="mt-2 flex items-center gap-1.5 text-secondary">
          <Icon size={13} className="shrink-0" aria-hidden />
          <MomentumBars direction={momentum.direction} />
          <span className="sr-only">
            {momentum.delta >= 0 ? "+" : ""}
            {momentum.delta.toFixed(1)} points
          </span>
        </p>
      }
    />
  );
}

function PerformanceBrief({
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
          Calculated · AI narration in Phase 4
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
