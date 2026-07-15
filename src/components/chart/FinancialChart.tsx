"use client";

import { useId } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinancialEvent, IndexPoint } from "@/lib/financial-engine/types";
import { formatShortDate } from "@/lib/financial-engine/format";
import { railPositions } from "@/lib/ui/math";

export interface ChartMarker {
  event: FinancialEvent;
  /** Indexed actual value on the event's date, so the marker sits on the line. */
  y: number;
}

interface FinancialChartProps {
  points: IndexPoint[];
  markers: ChartMarker[];
  /** Plain-language description for screen readers. */
  ariaDescription: string;
}

/**
 * The core PFI chart: indexed actual position (area), personal baseline
 * (dotted), and financial waterline (dashed). Purely presentational — every
 * value is computed upstream in the financial engine.
 */
export function FinancialChart({ points, markers, ariaDescription }: FinancialChartProps) {
  const gradientId = useId();

  // ~5 x-axis labels regardless of range length.
  const tickInterval = Math.max(1, Math.floor(points.length / 5));

  const lastPoint = points[points.length - 1];
  const yValues = points.flatMap((p) => [p.actual, p.waterline, ...(p.baseline === null ? [] : [p.baseline])]);
  const domainMin = Math.floor(Math.min(...yValues) - 4);
  const domainMax = Math.ceil(Math.max(...yValues) + 4);
  const [actualPos, baselinePos, waterlinePos] = railPositions(
    [lastPoint?.actual ?? null, lastPoint?.baseline ?? null, lastPoint?.waterline ?? null],
    domainMin,
    domainMax,
    9,
  );

  return (
    <figure aria-label={ariaDescription} className="m-0">
      <div className="flex w-full items-stretch">
        <div className="h-64 min-w-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-actual-fill-from)" />
                  <stop offset="100%" stopColor="var(--chart-actual-fill-to)" />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                interval={tickInterval}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                minTickGap={24}
              />
              <YAxis
                domain={[domainMin, domainMax]}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                width={46}
                tickFormatter={(v: number) => String(Math.round(v))}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="actual"
                name="Actual"
                stroke="var(--chart-actual)"
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: "var(--chart-actual)", stroke: "var(--bg-elevated)" }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="baseline"
                name="Baseline"
                stroke="var(--chart-baseline)"
                strokeWidth={1.5}
                strokeDasharray="1 4"
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="waterline"
                name="Waterline"
                stroke="var(--chart-waterline)"
                strokeWidth={1.5}
                strokeDasharray="6 5"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
              {markers.map((m) => (
                <ReferenceDot
                  key={m.event.id}
                  x={m.event.date}
                  y={m.y}
                  r={4}
                  fill={m.event.direction === "inflow" ? "var(--positive)" : "var(--negative)"}
                  stroke="var(--bg-elevated)"
                  strokeWidth={2}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div aria-hidden className="relative h-64 w-16 shrink-0">
          <RailLabel top={actualPos} color="var(--chart-actual)" label="Actual" />
          <RailLabel top={baselinePos} color="var(--chart-baseline)" label="Baseline" />
          <RailLabel top={waterlinePos} color="var(--chart-waterline)" label="Waterline" />
        </div>
      </div>
      <figcaption className="sr-only">{ariaDescription}</figcaption>
    </figure>
  );
}

const X_AXIS_HEIGHT = 30; // Recharts default XAxis height

function RailLabel({ top, color, label }: { top: number | null; color: string; label: string }) {
  if (top === null) return null;
  return (
    <span
      className="absolute left-1 flex -translate-y-1/2 items-center gap-1 text-[11px] text-secondary"
      style={{ top: `calc(${top} * (100% - ${X_AXIS_HEIGHT}px) / 100 + 8px)` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: number | string | null;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;
  const get = (key: string) => {
    const v = payload.find((p) => p.dataKey === key)?.value;
    return typeof v === "number" ? v.toFixed(1) : null;
  };
  const rows: Array<[string, string | null, string]> = [
    ["Actual", get("actual"), "var(--chart-actual)"],
    ["Baseline", get("baseline"), "var(--chart-baseline)"],
    ["Waterline", get("waterline"), "var(--chart-waterline)"],
  ];
  return (
    <div className="rounded-xl border border-border-subtle bg-elevated-2 px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-medium text-primary">{formatShortDate(label)}</p>
      {rows.map(
        ([name, value, color]) =>
          value !== null && (
            <p key={name} className="tabular flex items-center gap-1.5 text-secondary">
              <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
              {name}: <span className="text-primary">{value}</span>
            </p>
          ),
      )}
    </div>
  );
}
