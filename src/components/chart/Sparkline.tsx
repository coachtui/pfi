import { useId } from "react";

export type SparkTone = "positive" | "negative" | "warning" | "neutral";

const strokeByTone: Record<SparkTone, string> = {
  positive: "var(--positive)",
  negative: "var(--negative)",
  warning: "var(--warning)",
  neutral: "var(--neutral)",
};

/** Decorative mini line chart. Always pair with visible or sr-only text. */
export function Sparkline({
  values,
  tone = "neutral",
  fill = false,
  className = "mt-2 h-5 w-full",
}: {
  values: number[];
  tone?: SparkTone;
  fill?: boolean;
  className?: string;
}) {
  const gradientId = useId();
  if (values.length < 2) return null;
  const w = 96;
  const h = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map(
    (v, i) => [i * step, h - 3 - ((v - min) / span) * (h - 6)] as const,
  );
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const stroke = strokeByTone[tone];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden focusable="false" preserveAspectRatio="none">
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      )}
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" opacity={0.9} />
    </svg>
  );
}
