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
    <Card className="flex min-h-32 flex-col justify-between p-4">
      <p className="text-xs font-medium text-secondary">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${tone === "positive" ? "text-positive" : "text-negative"}`}>
        {value}
      </p>
      <p className="text-xs text-tertiary">{sub}</p>
      <Sparkline values={trend} tone={tone} fill />
    </Card>
  );
}
