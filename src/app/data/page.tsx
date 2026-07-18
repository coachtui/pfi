import { redirect } from "next/navigation";
import {
  ArrowUpRight, ChevronDown, CircleDollarSign, Droplet, Home, Info, MapPin, PiggyBank,
  TrendingUp, UserRound, type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/queries";
import { getBenchmarks, type CompareRow } from "@/lib/demo-data/cohorts";
import { Card } from "@/components/ui/Card";
import { PercentileBar } from "@/components/ui/PercentileBar";
import { TrendStatCard } from "@/components/dashboard/TrendStatCard";
import { formatSignedPercent } from "@/lib/financial-engine/format";
import { formatOrdinal } from "@/lib/ui/math";
import { ConditionsChart } from "./ConditionsChart";

const compareIcons: Record<CompareRow["icon"], LucideIcon> = {
  piggy: PiggyBank, home: Home, droplet: Droplet, trend: TrendingUp,
};

export default async function DataPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const b = getBenchmarks();

  const chips = [
    { icon: UserRound, label: `Age ${profile.age_cohort}` },
    { icon: CircleDollarSign, label: `Income ${profile.income_band}` },
    { icon: MapPin, label: profile.col_cohort },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Data</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-secondary">
          Benchmark Intelligence
          <Info size={14} aria-label="Anonymized cohort benchmarks for households like yours" />
        </p>
        <p className="mt-1 text-xs text-tertiary">Preview — sample cohort data</p>
      </header>

      <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5">
        {chips.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border-subtle bg-elevated px-2.5 py-1 text-xs text-secondary"
          >
            <Icon size={12} aria-hidden />
            {label}
          </span>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-primary">Household Financial Conditions</h2>
          <Info size={14} className="text-tertiary" aria-label="Sample index of overall household financial conditions in your cohort" />
        </div>
        <div className="mt-3 flex items-end gap-4">
          <div className="shrink-0">
            <p className="text-xs text-secondary">Conditions Index</p>
            <p className="tabular mt-1 text-4xl font-semibold text-primary">{b.conditionsIndex.toFixed(1)}</p>
            <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-positive">
              <ArrowUpRight size={12} aria-hidden />
              {b.conditionsNote}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <ConditionsChart data={b.conditionsTrend} />
          </div>
        </div>
      </Card>

      <section aria-label="Cohort benchmark stats" className="grid grid-cols-4 gap-2 md:gap-3">
        {b.stats.map((s) => (
          <TrendStatCard key={s.label} label={s.label} value={s.value} sub={s.vsCohort} tone={s.tone} trend={s.trend} />
        ))}
      </section>

      <Card className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-primary">
            How you compare
            <Info size={14} className="text-tertiary" aria-label="Your position within the cohort, by percentile" />
          </h2>
          <span
            className="flex items-center gap-1 rounded-full bg-positive-muted px-2.5 py-1 text-xs font-medium text-positive"
            title="Coming soon"
          >
            Percentile
            <ChevronDown size={12} aria-hidden />
          </span>
        </div>
        <ul className="flex flex-col gap-3.5">
          {b.compare.map((row) => {
            const Icon = compareIcons[row.icon];
            return (
              <li key={row.label} className="flex items-center gap-2.5">
                <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full ${row.goodDirection ? "bg-positive-muted text-positive" : "bg-negative-muted text-negative"}`}>
                  <Icon size={14} />
                </span>
                <div className="w-20 shrink-0 sm:w-24">
                  <p className="text-xs leading-tight font-medium text-primary">{row.label}</p>
                  <p className="tabular truncate text-[10px] text-tertiary">{row.viewerValue}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <PercentileBar percentile={row.percentile} goodDirection={row.goodDirection} />
                </div>
                <span className="tabular w-9 shrink-0 text-right text-sm font-semibold text-primary">
                  {formatOrdinal(row.percentile)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex items-center gap-2.5">
          <span aria-hidden className="size-7 shrink-0" />
          <span aria-hidden className="w-20 shrink-0 sm:w-24" />
          <div className="flex min-w-0 flex-1 justify-between text-[10px] text-tertiary">
            <span>0th</span>
            <span>50th</span>
            <span>100th</span>
          </div>
          <span aria-hidden className="w-9 shrink-0" />
        </div>
      </Card>

      <section aria-labelledby="cohort-trends">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="cohort-trends" className="flex items-center gap-1.5 text-base font-semibold text-primary">
            Cohort trends
            <Info size={14} className="text-tertiary" aria-label="Quarter-over-quarter changes across your cohort" />
          </h2>
          <span className="text-xs text-tertiary" title="Coming soon">View all</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {b.trends.map((t) => (
            <TrendStatCard
              key={t.label}
              label={t.label}
              value={formatSignedPercent(t.changePct)}
              sub="vs last quarter"
              tone={(t.changePct >= 0) === t.goodWhenRising ? "positive" : "negative"}
              trend={t.trend}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
