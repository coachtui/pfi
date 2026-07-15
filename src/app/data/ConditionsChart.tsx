"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { formatShortDate } from "@/lib/financial-engine/format";

export function ConditionsChart({ data }: { data: Array<{ date: string; value: number }> }) {
  const gradientId = useId();
  return (
    <div className="h-32 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-actual-fill-from)" />
              <stop offset="100%" stopColor="var(--chart-actual-fill-to)" />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tickFormatter={formatShortDate} interval={6} tickLine={false} axisLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 10 }} />
          <YAxis orientation="right" domain={[40, 80]} ticks={[40, 60, 80]} tickLine={false} axisLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 10 }} width={26} />
          <Area type="monotone" dataKey="value" stroke="var(--chart-actual)" strokeWidth={2} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
