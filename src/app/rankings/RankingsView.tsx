"use client";

import { useState } from "react";
import {
  ArrowDown, ArrowUp, BadgeCheck, CalendarCheck, ChevronRight, Info, Minus,
  Mountain, Shield, Sprout, Sun, TreePalm, TrendingUp, Waves, type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { formatOrdinal } from "@/lib/ui/math";
import type { LeaderboardEntry, LeagueData, LeagueKey } from "@/lib/demo-data/cohorts";

const LEAGUE_TABS = [
  { key: "age", label: "Age" },
  { key: "income", label: "Income" },
  { key: "region", label: "Region" },
  { key: "overall", label: "Overall" },
] as const;

const entryIcons: Record<LeaderboardEntry["icon"], LucideIcon> = {
  mountain: Mountain, waves: Waves, palm: TreePalm, sprout: Sprout, sun: Sun,
};

const accentClasses: Record<LeaderboardEntry["accent"], string> = {
  positive: "border-positive/50 text-positive",
  blue: "border-[color:var(--chart-waterline)]/50 text-[color:var(--chart-waterline)]",
  orange: "border-warning/60 text-warning",
};

interface Identity { companyName: string; ticker: string; username: string; level: number; }

export function RankingsView({
  leagues,
  identity,
}: {
  leagues: Record<LeagueKey, LeagueData>;
  identity: Identity;
}) {
  const [league, setLeague] = useState<LeagueKey>("age");
  const data = leagues[league];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Rankings</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-secondary">
          {data.leagueLabel}
          <Info size={14} aria-label="Leagues rank anonymized peers by quarterly improvement, never by wealth" />
        </p>
        <p className="mt-1 text-xs text-tertiary">Preview — sample cohort data</p>
      </header>

      <Segmented
        options={LEAGUE_TABS.map((t) => ({ key: t.key, label: t.label }))}
        value={league}
        onChange={(key) => setLeague(key as LeagueKey)}
        ariaLabel="League"
      />

      {/* Viewer card */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex size-12 items-center justify-center rounded-full border border-positive/50 text-positive">
            <TreePalm size={24} />
          </span>
          <div>
            <p className="text-base font-semibold text-primary">{identity.companyName}</p>
            <p className="tabular text-sm font-medium text-positive">{identity.ticker}</p>
            <p className="flex items-center gap-1 text-xs text-secondary">
              {identity.username}
              <BadgeCheck size={13} className="text-positive" aria-label="Verified data coverage" />
            </p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 divide-x divide-border-subtle rounded-xl border border-border-subtle bg-inset py-3 text-center">
          <div>
            <dt className="text-[11px] text-tertiary">Quarterly Rank</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold text-primary">#{data.viewer.rank}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-tertiary">Percentile</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold text-primary">{formatOrdinal(data.viewer.percentile)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-tertiary">Performance Score</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold text-positive">{data.viewer.performanceScore}</dd>
          </div>
        </dl>
      </Card>

      {/* Leaderboard */}
      <section aria-labelledby="leaderboard">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="leaderboard" className="text-base font-semibold text-primary">Leaderboard</h2>
          <span className="text-xs text-tertiary" title="Coming soon">Quarterly Performance ▾</span>
        </div>
        <ol className="flex flex-col gap-2">
          {data.leaderboard.map((e) => (
            <LeaderboardRow key={e.ticker + e.rank} entry={e} />
          ))}
        </ol>
      </section>

      {/* Challenges */}
      <section aria-labelledby="challenges">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="challenges" className="text-base font-semibold text-primary">Quarterly Challenges</h2>
          <span className="text-xs text-tertiary" title="Coming soon">View all</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <ChallengeCard icon={TrendingUp} title="Most Improved" description="Top % improvement this quarter" stat="Top 10%" progress={62} />
          <ChallengeCard icon={CalendarCheck} title="Savings Streak" description="Longest monthly savings streak" stat="12+ months" progress={80} />
          <ChallengeCard icon={Shield} title="Debt Crusher" description="Largest debt reduction" stat="Top 10%" progress={45} />
        </div>
      </section>
    </div>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const Icon = entryIcons[entry.icon];
  return (
    <li>
      <Card
        className={`flex min-h-16 items-center gap-3 p-3 ${entry.isViewer ? "border-positive/60" : ""}`}
      >
        <div className="flex w-7 flex-col items-center">
          <span className="tabular text-base font-semibold text-primary">{entry.rank}</span>
          <Movement value={entry.movement} />
        </div>
        <span aria-hidden className={`flex size-11 shrink-0 items-center justify-center rounded-full border ${accentClasses[entry.accent]}`}>
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-primary">{entry.companyName}</p>
          <p className="tabular text-xs font-medium text-positive">{entry.ticker}</p>
          <p className="truncate text-xs text-tertiary">{entry.username}</p>
        </div>
        <span className="tabular text-sm font-semibold text-positive">
          +{entry.quarterlyChangePct.toFixed(2)}%
        </span>
        <ChevronRight size={16} className="text-tertiary" aria-hidden />
      </Card>
    </li>
  );
}

function Movement({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="flex items-center text-tertiary">
        <Minus size={10} aria-hidden />
        <span className="sr-only">unchanged</span>
      </span>
    );
  }
  const up = value > 0;
  return (
    <span className={`tabular flex items-center text-[10px] font-medium ${up ? "text-positive" : "text-negative"}`}>
      {up ? <ArrowUp size={10} aria-hidden /> : <ArrowDown size={10} aria-hidden />}
      {Math.abs(value)}
      <span className="sr-only">{up ? "up" : "down"} {Math.abs(value)} places</span>
    </span>
  );
}

function ChallengeCard({
  icon: Icon,
  title,
  description,
  stat,
  progress,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  stat: string;
  progress: number;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-positive-muted text-positive">
        <Icon size={17} />
      </span>
      <p className="text-sm font-medium text-primary">{title}</p>
      <p className="text-xs leading-snug text-secondary">{description}</p>
      <div className="mt-auto">
        <div className="h-0.5 w-full rounded-full bg-elevated-2">
          <div className="h-full rounded-full bg-positive" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1.5 text-xs font-medium text-positive">{stat}</p>
      </div>
    </Card>
  );
}
