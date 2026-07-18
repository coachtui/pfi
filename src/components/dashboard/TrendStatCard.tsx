import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/chart/Sparkline";

/** Compact benchmark stat: label, headline value, comparison line, toned sparkline. */
export function TrendStatCard({
  label,
  value,
  sub,
  tone,
  trend,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "positive" | "negative";
  trend: number[];
}) {
  return (
    <Card className="flex min-h-24 flex-col justify-between p-2.5 sm:min-h-32 sm:p-4">
      <p className="text-[11px] leading-tight font-medium text-secondary sm:text-xs">{label}</p>
      <p
        className={`tabular mt-1 text-base font-semibold sm:text-xl ${tone === "positive" ? "text-positive" : "text-negative"}`}
      >
        {value}
      </p>
      <p className="text-[10px] leading-tight text-tertiary sm:text-xs">{sub}</p>
      <Sparkline values={trend} tone={tone} fill />
    </Card>
  );
}
