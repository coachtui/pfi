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

  return (
    <figure aria-label={ariaDescription} className="m-0">
      <div className="h-64 w-full">
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
              domain={[(min: number) => Math.floor(min - 4), (max: number) => Math.ceil(max + 4)]}
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
      <figcaption className="sr-only">{ariaDescription}</figcaption>
      <ChartLegend />
    </figure>
  );
}

/** Legend distinguishes lines by shape as well as color (never color alone). */
function ChartLegend() {
  return (
    <div className="mt-3 flex items-center gap-5 text-xs text-secondary">
      <LegendItem swatch={<span className="h-0.5 w-5 rounded bg-[var(--chart-actual)]" />} label="Actual" />
      <LegendItem
        swatch={
          <span className="flex w-5 items-center justify-between" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1 rounded-full bg-[var(--chart-baseline)]" />
            ))}
          </span>
        }
        label="Baseline"
      />
      <LegendItem
        swatch={
          <span className="flex w-5 items-center justify-between" aria-hidden>
            {[0, 1].map((i) => (
              <span key={i} className="h-0.5 w-2 rounded bg-[var(--chart-waterline)]" />
            ))}
          </span>
        }
        label="Waterline"
      />
    </div>
  );
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {swatch}
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
