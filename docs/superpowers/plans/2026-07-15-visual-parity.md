# Visual Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the three supplied mockups — polish the Home dashboard (chart texture, inline line labels, labeled event stems, momentum bars, avatar chip) and build the Rankings and Data screens on deterministic mock cohort data.

**Architecture:** A seeded mock cohort module (`src/lib/demo-data/cohorts.ts`) feeds both new screens; shared presentational pieces (Sparkline, Segmented, PercentileBar, TrendStatCard) are extracted/created; pure positioning math lives in `src/lib/ui/math.ts` with tests. Screens are server components; tab/range state lives in small client components.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Tailwind 4 tokens (globals.css), Recharts, lucide-react, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-visual-parity-design.md` (approved)

## Global Constraints

- Strict TS; `pnpm check` green at every commit; lint zero warnings.
- No financial formulas or data literals in components — mock data only from `src/lib/demo-data/cohorts.ts`; engine/demo-data stay free of React imports.
- Rankings rank by improvement (`quarterlyChangePct`), never wealth; "Performance Score" is sample data and never called a health/credit score.
- Both new screens carry the caption: `Preview — sample cohort data`.
- Never color alone: movement arrows pair glyph + signed number; percentile bars pair fill + value + percentile text.
- Mobile-first at 390×844; also verify 1280×900. Touch targets ≥ 44px for tappable rows/tabs. `cursor-pointer` on interactive elements; transitions 150–300ms.
- Demo data deterministic (mulberry32, fixed seeds). Demo tests (solvency > 0.7, improving arc, determinism) keep passing; tune demo constants only, note in commit.
- "View all" and sort labels ("Quarterly Performance ▾", "Percentile ▾") are static/no-op with `title="Coming soon"` and NO `cursor-pointer`.
- Design tokens only (bg-elevated, text-positive, var(--chart-*) etc.) — no new hex values in components.

---

### Task 1: Mock cohort data module

**Files:**
- Create: `src/lib/demo-data/cohorts.ts`
- Test: `src/lib/demo-data/cohorts.test.ts`

**Interfaces:**
- Consumes: `mulberry32` from `./prng`.
- Produces (Tasks 8–10 depend on these exact names):

```ts
export type LeagueKey = "age" | "income" | "region" | "overall";
export type LeaderboardIcon = "mountain" | "waves" | "palm" | "sprout" | "sun";
export interface LeaderboardEntry { rank: number; movement: number; companyName: string; ticker: string; username: string; quarterlyChangePct: number; icon: LeaderboardIcon; accent: "positive" | "blue" | "orange"; isViewer?: boolean; }
export interface LeagueData { leagueLabel: string; viewer: { rank: number; percentile: number; performanceScore: number }; leaderboard: LeaderboardEntry[]; }
export function getLeagues(): Record<LeagueKey, LeagueData>;
export interface BenchmarkStat { label: string; value: string; vsCohort: string; tone: "positive" | "negative"; trend: number[]; }
export interface CompareRow { label: string; viewerValue: string; percentile: number; goodDirection: boolean; icon: "piggy" | "home" | "droplet" | "trend"; }
export interface BenchmarkData { conditionsIndex: number; conditionsTrend: Array<{ date: string; value: number }>; conditionsNote: string; stats: BenchmarkStat[]; compare: CompareRow[]; trends: Array<{ label: string; changePct: number; goodWhenRising: boolean; trend: number[] }>; }
export function getBenchmarks(): BenchmarkData;
export const VIEWER_LEVEL = 7;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/demo-data/cohorts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getBenchmarks, getLeagues, VIEWER_LEVEL } from "./cohorts";

describe("getLeagues", () => {
  const leagues = getLeagues();

  it("is deterministic", () => {
    expect(getLeagues()).toEqual(leagues);
  });

  it("provides all four leagues with exactly one viewer row each", () => {
    for (const key of ["age", "income", "region", "overall"] as const) {
      const league = leagues[key];
      expect(league.leaderboard.filter((e) => e.isViewer)).toHaveLength(1);
      expect(league.leaderboard).toHaveLength(5);
    }
  });

  it("ranks by quarterly improvement, descending and contiguous", () => {
    for (const league of Object.values(leagues)) {
      const pcts = league.leaderboard.map((e) => e.quarterlyChangePct);
      expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
      expect(league.leaderboard.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("age league matches the mockup values", () => {
    const age = leagues.age;
    expect(age.viewer).toEqual({ rank: 126, percentile: 87, performanceScore: 784 });
    const koa = age.leaderboard.find((e) => e.isViewer)!;
    expect(koa.companyName).toBe("Koa Holdings");
    expect(koa.rank).toBe(3);
    expect(koa.quarterlyChangePct).toBeCloseTo(8.21);
    expect(koa.movement).toBe(5);
  });
});

describe("getBenchmarks", () => {
  const b = getBenchmarks();

  it("is deterministic", () => {
    expect(getBenchmarks()).toEqual(b);
  });

  it("matches mockup headline values", () => {
    expect(b.conditionsIndex).toBeCloseTo(72.4);
    expect(b.stats).toHaveLength(4);
    expect(b.compare).toHaveLength(4);
    expect(b.trends).toHaveLength(3);
    expect(b.compare[1].goodDirection).toBe(false); // Fixed-Cost Burden
    expect(b.compare.map((c) => c.percentile)).toEqual([78, 34, 72, 65]);
  });

  it("trend series are non-trivial and bounded", () => {
    for (const stat of b.stats) expect(stat.trend.length).toBeGreaterThanOrEqual(12);
    expect(b.conditionsTrend.length).toBeGreaterThanOrEqual(20);
    for (const p of b.conditionsTrend) expect(p.value).toBeGreaterThan(0);
  });
});

it("exposes the sample gamification level", () => {
  expect(VIEWER_LEVEL).toBe(7);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/demo-data/cohorts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/demo-data/cohorts.ts`:

```ts
import { mulberry32 } from "./prng";

/**
 * Deterministic MOCK cohort/benchmark data for the Rankings and Data screens.
 * Real anonymized cohort pipelines are Phase 6; every consumer of this module
 * must present its values as sample data ("Preview — sample cohort data").
 * Rankings are ordered by quarterly improvement — never absolute wealth.
 */

export type LeagueKey = "age" | "income" | "region" | "overall";
export type LeaderboardIcon = "mountain" | "waves" | "palm" | "sprout" | "sun";

export interface LeaderboardEntry {
  rank: number;
  /** Positive = moved up this quarter, negative = down, 0 = unchanged. */
  movement: number;
  companyName: string;
  ticker: string;
  username: string;
  /** Normalized improvement metric — the ranking key. */
  quarterlyChangePct: number;
  icon: LeaderboardIcon;
  accent: "positive" | "blue" | "orange";
  isViewer?: boolean;
}

export interface LeagueData {
  leagueLabel: string;
  viewer: { rank: number; percentile: number; performanceScore: number };
  leaderboard: LeaderboardEntry[];
}

/** Gamification level is Phase 6; until then it is sample data, sourced here. */
export const VIEWER_LEVEL = 7;

const entry = (
  rank: number,
  movement: number,
  companyName: string,
  ticker: string,
  username: string,
  quarterlyChangePct: number,
  icon: LeaderboardIcon,
  accent: LeaderboardEntry["accent"],
  isViewer = false,
): LeaderboardEntry => ({
  rank, movement, companyName, ticker, username, quarterlyChangePct, icon, accent,
  ...(isViewer ? { isViewer } : {}),
});

export function getLeagues(): Record<LeagueKey, LeagueData> {
  return {
    age: {
      leagueLabel: "40–49 Age League",
      viewer: { rank: 126, percentile: 87, performanceScore: 784 },
      leaderboard: [
        entry(1, 2, "North Shore Capital", "$NSHC", "WaveRider", 12.48, "mountain", "positive"),
        entry(2, -1, "Blue Reef Partners", "$BRFP", "CoralTrader", 9.73, "waves", "blue"),
        entry(3, 5, "Koa Holdings", "$KOAH", "IslandBuilder", 8.21, "palm", "positive", true),
        entry(4, -1, "Haleiwa Growth", "$HLGW", "GreenSeeker", 6.34, "sprout", "positive"),
        entry(5, 0, "Sunset Wealth", "$SNWT", "AlohaFin", 5.18, "sun", "orange"),
      ],
    },
    income: {
      leagueLabel: "$150k–$200k Income League",
      viewer: { rank: 214, percentile: 81, performanceScore: 784 },
      leaderboard: [
        entry(1, 1, "Windward Trust", "$WWTR", "TradeWinds", 11.02, "waves", "blue"),
        entry(2, 3, "Koa Holdings", "$KOAH", "IslandBuilder", 8.21, "palm", "positive", true),
        entry(3, -2, "Mauka Ventures", "$MKVN", "UphillSaver", 7.9, "mountain", "positive"),
        entry(4, 0, "Lanai Legacy", "$LNLG", "SteadyPalm", 6.71, "sprout", "positive"),
        entry(5, -1, "Golden Hour Co", "$GHCO", "DuskInvestor", 4.95, "sun", "orange"),
      ],
    },
    region: {
      leagueLabel: "High-Cost Region League",
      viewer: { rank: 342, percentile: 74, performanceScore: 784 },
      leaderboard: [
        entry(1, 0, "Summit Holdings", "$SMHD", "PeakSeeker", 13.11, "mountain", "positive"),
        entry(2, 2, "Tidepool Capital", "$TDPC", "ReefKeeper", 10.4, "waves", "blue"),
        entry(3, -1, "Sunrise Partners", "$SRPS", "DawnPatrol", 9.02, "sun", "orange"),
        entry(4, 4, "Koa Holdings", "$KOAH", "IslandBuilder", 8.21, "palm", "positive", true),
        entry(5, -2, "Palm Grove Fund", "$PGFD", "ShadeGrower", 7.66, "sprout", "positive"),
      ],
    },
    overall: {
      leagueLabel: "Overall League",
      viewer: { rank: 1893, percentile: 79, performanceScore: 784 },
      leaderboard: [
        entry(1, 3, "Makai Industries", "$MKAI", "OceanForward", 14.63, "waves", "blue"),
        entry(2, -1, "Ridge Line Capital", "$RGLC", "CrestRunner", 12.9, "mountain", "positive"),
        entry(3, 1, "Seed & Stone", "$SDST", "PatientGrower", 10.05, "sprout", "positive"),
        entry(4, -2, "Horizon Wealth", "$HZWL", "FarSighted", 9.31, "sun", "orange"),
        entry(5, 6, "Koa Holdings", "$KOAH", "IslandBuilder", 8.21, "palm", "positive", true),
      ],
    },
  };
}

export interface BenchmarkStat {
  label: string;
  value: string;
  vsCohort: string;
  tone: "positive" | "negative";
  trend: number[];
}

export interface CompareRow {
  label: string;
  viewerValue: string;
  percentile: number;
  /** false → this metric is "lower is better" and renders negative-toned. */
  goodDirection: boolean;
  icon: "piggy" | "home" | "droplet" | "trend";
}

export interface BenchmarkData {
  conditionsIndex: number;
  conditionsTrend: Array<{ date: string; value: number }>;
  conditionsNote: string;
  stats: BenchmarkStat[];
  compare: CompareRow[];
  trends: Array<{ label: string; changePct: number; goodWhenRising: boolean; trend: number[] }>;
}

/** Seeded random walk used for every mock series. */
function walk(seed: number, length: number, start: number, drift: number, vol: number): number[] {
  const rand = mulberry32(seed);
  const out = [start];
  for (let i = 1; i < length; i++) {
    out.push(Math.round((out[i - 1] + drift + (rand() - 0.5) * vol) * 100) / 100);
  }
  return out;
}

const CONDITIONS_DATES: string[] = (() => {
  // 30 days ending at the demo "today" (2026-07-15), matching the demo dataset's fixed clock.
  const out: string[] = [];
  const end = Date.UTC(2026, 6, 15);
  for (let i = 29; i >= 0; i--) out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  return out;
})();

export function getBenchmarks(): BenchmarkData {
  const conditions = walk(42, 30, 62, 0.36, 3.4);
  return {
    conditionsIndex: 72.4,
    conditionsTrend: CONDITIONS_DATES.map((date, i) => ({ date, value: conditions[i] })),
    conditionsNote: "Improving this quarter",
    stats: [
      { label: "Median Savings Margin", value: "18.6%", vsCohort: "vs cohort 15.2%", tone: "positive", trend: walk(7, 16, 16, 0.15, 1.6) },
      { label: "Users Below Baseline", value: "38%", vsCohort: "vs cohort 47%", tone: "negative", trend: walk(8, 16, 44, -0.35, 2.2) },
      { label: "Liquid Runway", value: "3.7 mo", vsCohort: "vs cohort 2.6 mo", tone: "positive", trend: walk(9, 16, 3.1, 0.04, 0.35) },
      { label: "Debt Pressure", value: "+7.2%", vsCohort: "vs cohort +10.1%", tone: "negative", trend: walk(10, 16, 9.5, -0.14, 0.9) },
    ],
    compare: [
      { label: "Savings Efficiency", viewerValue: "Koa: 18.6%", percentile: 78, goodDirection: true, icon: "piggy" },
      { label: "Fixed-Cost Burden", viewerValue: "Koa: 28.4%", percentile: 34, goodDirection: false, icon: "home" },
      { label: "Liquidity Strength", viewerValue: "Koa: 3.7 mo", percentile: 72, goodDirection: true, icon: "droplet" },
      { label: "Investment Consistency", viewerValue: "Koa: 82%", percentile: 65, goodDirection: true, icon: "trend" },
    ],
    trends: [
      { label: "Discretionary Spending", changePct: -2.4, goodWhenRising: false, trend: walk(21, 16, 100, -0.5, 3) },
      { label: "Investment Contributions", changePct: 4.1, goodWhenRising: true, trend: walk(22, 16, 100, 0.8, 3) },
      { label: "Credit Card Growth", changePct: 6.8, goodWhenRising: false, trend: walk(23, 16, 100, 1.1, 3.4) },
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/demo-data/cohorts.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/demo-data/cohorts.ts src/lib/demo-data/cohorts.test.ts
git commit -m "feat: deterministic mock cohort + benchmark data module"
```

---

### Task 2: Extract Sparkline and Segmented

**Files:**
- Create: `src/components/chart/Sparkline.tsx`, `src/components/ui/Segmented.tsx`
- Modify: `src/components/dashboard/MetricCard.tsx` (remove inline sparkline, consume Sparkline), `src/components/dashboard/HomeDashboard.tsx` (range pills → Segmented)

**Interfaces:**
- Produces:

```ts
// Sparkline.tsx (server-compatible; no hooks besides useId)
export type SparkTone = "positive" | "negative" | "warning" | "neutral";
export function Sparkline(props: { values: number[]; tone?: SparkTone; fill?: boolean; className?: string }): JSX.Element | null;

// Segmented.tsx ("use client")
export function Segmented(props: {
  options: ReadonlyArray<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}): JSX.Element;
```

- [ ] **Step 1: Create Sparkline**

Create `src/components/chart/Sparkline.tsx`:

```tsx
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
```

- [ ] **Step 2: MetricCard consumes Sparkline**

In `src/components/dashboard/MetricCard.tsx`: delete the local `Sparkline` function and the `toneStroke` record; add `import { Sparkline } from "@/components/chart/Sparkline";` and replace the usage with `<Sparkline values={trend} tone={tone} />`. `MetricTone` keys match `SparkTone` exactly, so the prop passes through. Keep the `trendDescription` sr-only span.

- [ ] **Step 3: Create Segmented and swap into HomeDashboard**

Create `src/components/ui/Segmented.tsx`:

```tsx
"use client";

export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-full border border-border-subtle bg-inset p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`min-h-8 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200 ${
            value === o.key ? "bg-elevated-2 text-primary shadow-card" : "text-secondary hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

In `src/components/dashboard/HomeDashboard.tsx`: replace the inline range-pill `<div role="group">…</div>` block with:

```tsx
<Segmented
  options={RANGES.map((r) => ({ key: r.key, label: r.key }))}
  value={range}
  onChange={(key) => setRange(key as RangeKey)}
  ariaLabel="Chart time range"
/>
```

adding `import { Segmented } from "@/components/ui/Segmented";`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green (no behavior change — pure extraction).

```bash
git add src/components/chart/Sparkline.tsx src/components/ui/Segmented.tsx src/components/dashboard/MetricCard.tsx src/components/dashboard/HomeDashboard.tsx
git commit -m "refactor: extract Sparkline and Segmented shared components"
```

---

### Task 3: UI math helpers (TDD)

**Files:**
- Create: `src/lib/ui/math.ts`
- Test: `src/lib/ui/math.test.ts`

**Interfaces:**
- Produces (Tasks 4, 6, 7 depend on):

```ts
export function clampPercent(n: number): number; // 0..100
export function markerXFraction(index: number, count: number): number; // 0..1, 0.5 when count<=1
export function railPositions(values: Array<number | null>, min: number, max: number, minGapPct: number): Array<number | null>;
export function formatOrdinal(n: number): string; // 87 → "87th", 72 → "72nd"
```

- [ ] **Step 1: Write failing tests**

Create `src/lib/ui/math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampPercent, formatOrdinal, markerXFraction, railPositions } from "./math";

describe("clampPercent", () => {
  it("clamps into 0..100", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(34)).toBe(34);
    expect(clampPercent(140)).toBe(100);
  });
});

describe("markerXFraction", () => {
  it("maps an index into 0..1 across the range", () => {
    expect(markerXFraction(0, 30)).toBe(0);
    expect(markerXFraction(29, 30)).toBe(1);
    expect(markerXFraction(14, 29)).toBe(0.5);
  });
  it("centers when there is one or zero points", () => {
    expect(markerXFraction(0, 1)).toBe(0.5);
    expect(markerXFraction(0, 0)).toBe(0.5);
  });
});

describe("railPositions", () => {
  it("maps values to top-percentages (max → 0, min → 100)", () => {
    expect(railPositions([80, 100, 90], 80, 100, 0)).toEqual([100, 0, 50]);
  });
  it("passes nulls through", () => {
    expect(railPositions([100, null, 80], 80, 100, 0)).toEqual([0, null, 100]);
  });
  it("nudges labels apart to enforce a minimum gap, preserving order", () => {
    const out = railPositions([100, 99.5, 80], 80, 100, 10) as number[];
    expect(out[1] - out[0]).toBeGreaterThanOrEqual(10);
    expect(out[2]).toBe(100);
    expect(out[0]).toBeLessThan(out[1]);
  });
  it("handles a flat domain without NaN", () => {
    expect(railPositions([5, 5], 5, 5, 0)).toEqual([50, 50]);
  });
});

describe("formatOrdinal", () => {
  it("formats English ordinals including teens", () => {
    expect(formatOrdinal(1)).toBe("1st");
    expect(formatOrdinal(72)).toBe("72nd");
    expect(formatOrdinal(34)).toBe("34th");
    expect(formatOrdinal(87)).toBe("87th");
    expect(formatOrdinal(11)).toBe("11th");
    expect(formatOrdinal(112)).toBe("112th");
    expect(formatOrdinal(103)).toBe("103rd");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/ui/math.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/ui/math.ts`:

```ts
/** Pure positioning math for chart adornments. No React, fully unit-tested. */

export function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** Horizontal fraction (0..1) of point `index` across `count` evenly spaced points. */
export function markerXFraction(index: number, count: number): number {
  if (count <= 1) return 0.5;
  return index / (count - 1);
}

/**
 * Vertical label positions (percent from top) for values on a shared axis
 * rail: max maps to 0, min to 100. Labels closer than `minGapPct` are nudged
 * downward in value order so they never overlap. Nulls pass through.
 */
export function railPositions(
  values: Array<number | null>,
  min: number,
  max: number,
  minGapPct: number,
): Array<number | null> {
  const span = max - min;
  const raw = values.map((v) =>
    v === null ? null : span === 0 ? 50 : clampPercent(((max - v) / span) * 100),
  );
  const indexed = raw
    .map((pct, i) => ({ pct, i }))
    .filter((x): x is { pct: number; i: number } => x.pct !== null)
    .sort((a, b) => a.pct - b.pct);
  for (let k = 1; k < indexed.length; k++) {
    if (indexed[k].pct - indexed[k - 1].pct < minGapPct) {
      indexed[k].pct = indexed[k - 1].pct + minGapPct;
    }
  }
  const out: Array<number | null> = [...raw];
  for (const { pct, i } of indexed) out[i] = pct;
  return out;
}

/** English ordinal formatting: 87 → "87th", 72 → "72nd", 11 → "11th". */
export function formatOrdinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  const suffix =
    rem100 >= 11 && rem100 <= 13 ? "th"
    : rem10 === 1 ? "st"
    : rem10 === 2 ? "nd"
    : rem10 === 3 ? "rd"
    : "th";
  return `${n}${suffix}`;
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `pnpm vitest run src/lib/ui/math.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS / clean.

```bash
git add src/lib/ui
git commit -m "feat: pure UI positioning math (clamp, marker fraction, label rail)"
```

---

### Task 4: PercentileBar + TrendStatCard

**Files:**
- Create: `src/components/ui/PercentileBar.tsx`, `src/components/dashboard/TrendStatCard.tsx`

**Interfaces:**
- Consumes: `clampPercent` (Task 3), `Sparkline` (Task 2), `Card`.
- Produces:

```ts
export function PercentileBar(props: { percentile: number; goodDirection: boolean }): JSX.Element;
export function TrendStatCard(props: { label: string; value: string; sub: string; tone: "positive" | "negative"; trend: number[] }): JSX.Element;
```

- [ ] **Step 1: PercentileBar**

Create `src/components/ui/PercentileBar.tsx`:

```tsx
import { clampPercent } from "@/lib/ui/math";

/** Horizontal percentile bar with a 50th-percentile tick. Meaning is always
 * duplicated in adjacent text — the bar itself is decorative reinforcement. */
export function PercentileBar({
  percentile,
  goodDirection,
}: {
  percentile: number;
  goodDirection: boolean;
}) {
  const pct = clampPercent(percentile);
  const barColor = goodDirection ? "bg-positive" : "bg-negative";
  return (
    <div
      role="img"
      aria-label={`${pct}th percentile`}
      className="relative h-1.5 w-full rounded-full bg-elevated-2"
    >
      <div className={`absolute inset-y-0 left-0 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      <div aria-hidden className="absolute top-1/2 left-1/2 h-3 w-px -translate-y-1/2 border-l border-dashed border-border-strong" />
    </div>
  );
}
```

- [ ] **Step 2: TrendStatCard**

Create `src/components/dashboard/TrendStatCard.tsx`:

```tsx
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
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: clean (presentational only; consumed in Tasks 9–10).

```bash
git add src/components/ui/PercentileBar.tsx src/components/dashboard/TrendStatCard.tsx
git commit -m "feat: PercentileBar and TrendStatCard shared components"
```

---

### Task 5: Demo chart texture

**Files:**
- Modify: `src/lib/demo-data/koa-holdings.ts` (three constants-area lines only)

- [ ] **Step 1: Widen daily variance, means unchanged**

In `generateKoaHoldings()`'s day loop:

```ts
// before: const essentials = ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 30);
const essentials = ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 100);

// before: const cardSpend = Math.round(13 + rand() * 16);
const cardSpend = Math.round(4 + rand() * 32);

// before: if (rand() < 0.024) { const amount = Math.round(250 + rand() * 450);
if (rand() < 0.05) {
  const amount = Math.round(150 + rand() * 300);
```

Update the comment above the card-spend line: mean stays ~$20/day (~$600/mo) under the $640 payment.

- [ ] **Step 2: Run the demo tests**

Run: `pnpm vitest run src/lib/demo-data`
Expected: PASS. If `above waterline` (>0.7) or `improving arc` (>100) fails, raise the starting `checking` balance in steps of +500 (only that constant) until green, and state the final value in the commit message.

- [ ] **Step 3: Full check + visual sanity**

Run: `pnpm check`. Then with the running dev server (http://localhost:3000, browse CLI `B="$HOME/.claude/skills/gstack/browse/dist/browse"`): `$B reload`, screenshot, Read it — the 30D actual line should now read visibly jagged. NOTE: the dashboard reads DB snapshots — reseeding is required to see the change: sign-in state from earlier testing may exist; if the dashboard shows old data, this task only asserts tests/check pass; the visual re-seed happens in Task 11's verification (which re-seeds demo data).

- [ ] **Step 4: Commit**

```bash
git add src/lib/demo-data/koa-holdings.ts
git commit -m "feat: widen demo daily spending variance for market-like chart texture"
```

---

### Task 6: Chart inline line labels

**Files:**
- Modify: `src/components/chart/FinancialChart.tsx`

**Interfaces:**
- Consumes: `railPositions` (Task 3).
- Produces: same `FinancialChart` props (unchanged signature); legend row removed.

- [ ] **Step 1: Add a label rail, remove the legend**

Rework the figure layout in `FinancialChart.tsx`: wrap the chart and a new right-side rail in a flex row. Replace the current `<div className="h-64 w-full">…</div>` + `<ChartLegend />` with:

```tsx
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
```

```tsx
<div className="flex w-full items-stretch">
  <div className="h-64 min-w-0 flex-1">
    <ResponsiveContainer width="100%" height="100%">
      {/* existing ComposedChart, with YAxis domain={[domainMin, domainMax]} */}
    </ResponsiveContainer>
  </div>
  <div aria-hidden className="relative h-64 w-16 shrink-0">
    <RailLabel top={actualPos} color="var(--chart-actual)" label="Actual" />
    <RailLabel top={baselinePos} color="var(--chart-baseline)" label="Baseline" />
    <RailLabel top={waterlinePos} color="var(--chart-waterline)" label="Waterline" />
  </div>
</div>
```

with, at module level:

```tsx
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
```

(The `+ 8px` matches the chart's `margin.top`; the rail mirrors the plot area's vertical extent.) Change the `YAxis` `domain` prop to the precomputed `[domainMin, domainMax]` (replacing the inline functions — same values, now shared with the rail). Delete `ChartLegend` and `LegendItem` entirely. Keep the sr-only figcaption (it already names all three lines and their values — the accessible description does not regress by removing the visual legend).

- [ ] **Step 2: Verify**

Run: `pnpm check`. Browser: reload http://localhost:3000 at 390×844, screenshot, Read it. Expect the three dot-labels at the right edge, vertically near their line endpoints, never overlapping (Waterline sits far below). Rotate through 30D/90D/1Y/All — labels track the last visible point of each range? **No — they track the full-series last point by design (all ranges end at "today"), which is the same point. Confirm labels stay put across ranges.**

- [ ] **Step 3: Commit**

```bash
git add src/components/chart/FinancialChart.tsx
git commit -m "feat: inline end-of-line labels replace chart legend"
```

---

### Task 7: Labeled event stems

**Files:**
- Modify: `src/components/chart/FinancialChart.tsx`, `src/components/dashboard/HomeDashboard.tsx`

**Interfaces:**
- Consumes: `markerXFraction` (Task 3), existing `ChartMarker`.
- Produces: `FinancialChart` gains optional prop `stems?: StemMarker[]`:

```ts
export interface StemMarker { event: FinancialEvent; pointIndex: number; }
```

- [ ] **Step 1: Select stem markers in HomeDashboard**

In `HomeDashboard.tsx`, add below `selectMarkers`:

```ts
const STEM_TYPES: FinancialEvent["type"][] = ["paycheck", "mortgage_payment", "bonus"];
const STEM_MAX_RANGE_DAYS = 45;

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
```

Compute `const stems = selectStems(events, visible);` inside the existing `view` memo and pass `stems={view.stems}` to `FinancialChart`. Import `StemMarker` from the chart module.

- [ ] **Step 2: Render stems in FinancialChart**

In `FinancialChart.tsx`:
- Add `ReferenceLine` to the recharts import.
- Props gain `stems?: StemMarker[]` (default `[]`); export the `StemMarker` interface as above.
- Inside the `ComposedChart`, after the `ReferenceDot` markers, render a dashed drop line per stem:

```tsx
{stems.map((s) => (
  <ReferenceLine
    key={`stem-${s.event.id}`}
    x={s.event.date}
    stroke="var(--border-strong)"
    strokeDasharray="3 4"
  />
))}
```

- Below the chart+rail flex row (inside the `<figure>`), render the chip row (icons reuse the event-icon map — import `eventIcons` after exporting it from `WhatMovedYourLine.tsx`: change its declaration to `export const eventIcons` and import it here):

```tsx
{stems.length > 0 && (
  <div aria-hidden className="relative mt-1 h-14" style={{ marginLeft: PLOT_LEFT_INSET, marginRight: 4 + 64 }}>
    {stems.map((s) => {
      const Icon = eventIcons[s.event.type];
      const leftPct = markerXFraction(s.pointIndex, points.length) * 100;
      const inflow = s.event.direction === "inflow";
      return (
        <div
          key={`chip-${s.event.id}`}
          className="absolute flex w-16 -translate-x-1/2 flex-col items-center gap-1"
          style={{ left: `${leftPct}%` }}
        >
          <span className={`flex size-7 items-center justify-center rounded-full border bg-elevated ${inflow ? "border-positive/40 text-positive" : "border-negative/40 text-negative"}`}>
            <Icon size={13} />
          </span>
          <span className="max-w-16 truncate text-[10px] text-tertiary">{s.event.label}</span>
        </div>
      );
    })}
  </div>
)}
```

with `const PLOT_LEFT_INSET = 28; // YAxis width 46 + chart margin left −18` at module level. The `64` in `marginRight` is the rail width (w-16) so chip x-fractions align with the plot area.
- Extend the sr-only figcaption: append `Notable events: ${stems.map((s) => `${s.event.label} on ${formatShortDate(s.event.date)}`).join(", ")}.` when stems exist (screen-reader parity for the aria-hidden chips).

- [ ] **Step 3: Verify**

Run: `pnpm check`. Browser at 390×844: 30D range shows up to 3 dashed drop lines with icon+label chips beneath the axis, horizontally aligned with their dates (compare against the Home mockup); 90D/1Y/All show none. Screenshot and Read.

- [ ] **Step 4: Commit**

```bash
git add src/components/chart/FinancialChart.tsx src/components/dashboard/HomeDashboard.tsx src/components/dashboard/WhatMovedYourLine.tsx
git commit -m "feat: labeled event stems beneath the chart on short ranges"
```

---

### Task 8: Momentum bars + avatar chip

**Files:**
- Modify: `src/components/dashboard/HomeDashboard.tsx` (MomentumCard), `src/components/dashboard/CompanyHeader.tsx`, `src/app/page.tsx`

**Interfaces:**
- Consumes: `VIEWER_LEVEL` (Task 1); `DashboardIdentity.level` already exists.

- [ ] **Step 1: Momentum bars glyph**

In `HomeDashboard.tsx`'s `MomentumCard`, replace the footer arrow+delta line with bars + arrow + delta:

```tsx
function MomentumBars({ direction }: { direction: Momentum["direction"] }) {
  const heights = direction === "improving" ? [5, 8, 11, 14] : direction === "declining" ? [14, 11, 8, 5] : [9, 9, 9, 9];
  const fill = direction === "improving" ? "var(--positive)" : direction === "declining" ? "var(--warning)" : "var(--neutral)";
  return (
    <svg viewBox="0 0 30 16" className="h-4 w-8" aria-hidden focusable="false">
      {heights.map((h, i) => (
        <rect key={i} x={i * 8} y={16 - h} width={5} height={h} rx={1.5} fill={fill} opacity={0.4 + i * 0.2} />
      ))}
    </svg>
  );
}
```

Footer becomes:

```tsx
footer={
  <p className="mt-2 flex items-center gap-2 text-xs text-secondary">
    <Icon size={14} aria-hidden />
    <MomentumBars direction={momentum.direction} />
    <span className="tabular">
      {momentum.delta >= 0 ? "+" : ""}
      {momentum.delta.toFixed(1)} pts
    </span>
  </p>
}
```

- [ ] **Step 2: Avatar chip in CompanyHeader**

In `CompanyHeader.tsx`, replace the current `LV. {level}` pill with an avatar chip:

```tsx
{level !== undefined && (
  <span className="relative flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-positive/30 via-elevated-2 to-[color:var(--chart-waterline)]/20 text-positive">
    <TreePalm size={22} aria-hidden />
    <span className="absolute -bottom-1 rounded-full border border-border-subtle bg-elevated px-1.5 text-[9px] font-semibold text-secondary">
      LV. {level}
    </span>
    <span className="sr-only">Level {level}</span>
  </span>
)}
```

- [ ] **Step 3: Thread the sample level from the cohorts module**

In `src/app/page.tsx`, import `VIEWER_LEVEL` from `@/lib/demo-data/cohorts` and pass `level: VIEWER_LEVEL` in the `profile` object given to `HomeDashboard`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm check`. Browser screenshot at 390×844: momentum card shows ascending emerald bars; header right shows the palm avatar chip with LV badge.

```bash
git add src/components/dashboard/HomeDashboard.tsx src/components/dashboard/CompanyHeader.tsx src/app/page.tsx
git commit -m "feat: momentum bars glyph and level avatar chip"
```

---

### Task 9: Rankings screen

**Files:**
- Create: `src/app/rankings/RankingsView.tsx`
- Modify: `src/app/rankings/page.tsx` (replace ComingSoon; keep the `ComingSoon` component — `/report` still uses it)

**Interfaces:**
- Consumes: `getLeagues`, `LeagueKey`, `LeaderboardEntry`, `VIEWER_LEVEL` (Task 1); `Segmented` (Task 2); `Card`; queries `getProfile`/`getCompany`; server `createClient`.

- [ ] **Step 1: Server page**

Replace `src/app/rankings/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany, getProfile } from "@/lib/data/queries";
import { getLeagues, VIEWER_LEVEL } from "@/lib/demo-data/cohorts";
import { RankingsView } from "./RankingsView";

export default async function RankingsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const company = await getCompany(supabase);
  if (!company) redirect("/onboarding");

  return (
    <RankingsView
      leagues={getLeagues()}
      identity={{
        companyName: company.name,
        ticker: company.ticker,
        username: profile.username,
        level: VIEWER_LEVEL,
      }}
    />
  );
}
```

- [ ] **Step 2: Client view**

Create `src/app/rankings/RankingsView.tsx`:

```tsx
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
```

- [ ] **Step 3: Verify**

Run: `pnpm check` (route `/rankings` now dynamic in build output). Browser at 390×844 (session from earlier testing should still exist; if logged out, run the Task-12-era login bootstrap: `pnpm exec tsx --env-file=.env.local scripts/dev-login.ts` is broken for callback — instead reuse the browse session which retained cookies; if truly logged out, verify after Task 11's full login pass): open /rankings, screenshot, Read, compare to the Rankings mockup. Tabs switch leagues; Koa row highlighted; movement arrows show; challenges row renders 3-up (mockup shows 3 columns even on mobile — grid-cols-3 stands).

- [ ] **Step 4: Commit**

```bash
git add src/app/rankings
git commit -m "feat: rankings screen — leagues, leaderboard, challenges (sample data)"
```

---

### Task 10: Data screen

**Files:**
- Create: `src/app/data/ConditionsChart.tsx`
- Modify: `src/app/data/page.tsx` (replace ComingSoon)

**Interfaces:**
- Consumes: `getBenchmarks`, `BenchmarkData`, `CompareRow` (Task 1); `TrendStatCard`, `PercentileBar` (Task 4); `formatShortDate` (engine format); queries/profile.

- [ ] **Step 1: Conditions chart (client)**

Create `src/app/data/ConditionsChart.tsx`:

```tsx
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
```

- [ ] **Step 2: Server page**

Replace `src/app/data/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import {
  ArrowUpRight, CircleDollarSign, Droplet, Home, Info, MapPin, PiggyBank,
  TrendingUp, UserRound, type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/queries";
import { getBenchmarks, type CompareRow } from "@/lib/demo-data/cohorts";
import { Card } from "@/components/ui/Card";
import { PercentileBar } from "@/components/ui/PercentileBar";
import { TrendStatCard } from "@/components/dashboard/TrendStatCard";
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

      <div className="flex flex-wrap gap-2">
        {chips.map(({ icon: Icon, label }) => (
          <span key={label} className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-elevated px-3 py-1.5 text-xs text-secondary">
            <Icon size={13} aria-hidden />
            {label}
          </span>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-primary">Household Financial Conditions</h2>
          <Info size={14} className="text-tertiary" aria-label="Sample index of overall household financial conditions in your cohort" />
        </div>
        <div className="mt-3 flex items-end gap-6">
          <div className="shrink-0">
            <p className="text-xs text-secondary">Conditions Index</p>
            <p className="tabular mt-1 text-4xl font-semibold text-primary">{b.conditionsIndex.toFixed(1)}</p>
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-positive">
              <ArrowUpRight size={13} aria-hidden />
              {b.conditionsNote}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <ConditionsChart data={b.conditionsTrend} />
          </div>
        </div>
      </Card>

      <section aria-label="Cohort benchmark stats" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {b.stats.map((s) => (
          <TrendStatCard key={s.label} label={s.label} value={s.value} sub={s.vsCohort} tone={s.tone} trend={s.trend} />
        ))}
      </section>

      <Card className="p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-primary">
            How you compare
            <Info size={14} className="text-tertiary" aria-label="Your position within the cohort, by percentile" />
          </h2>
          <span className="text-xs text-tertiary" title="Coming soon">Percentile ▾</span>
        </div>
        <ul className="flex flex-col gap-4">
          {b.compare.map((row) => {
            const Icon = compareIcons[row.icon];
            return (
              <li key={row.label} className="flex items-center gap-3">
                <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full ${row.goodDirection ? "bg-positive-muted text-positive" : "bg-negative-muted text-negative"}`}>
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-primary">{row.label}</p>
                  <p className="tabular text-xs text-tertiary">{row.viewerValue}</p>
                  <div className="mt-1.5">
                    <PercentileBar percentile={row.percentile} goodDirection={row.goodDirection} />
                  </div>
                </div>
                <span className="tabular w-12 text-right text-sm font-semibold text-primary">{formatOrdinal(row.percentile)}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex justify-between pl-12 text-[10px] text-tertiary">
          <span>0th</span><span>50th</span><span>100th</span>
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
              value={`${t.changePct > 0 ? "+" : "−"}${Math.abs(t.changePct).toFixed(1)}%`}
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

```

Tone note (matches the mockup's semantics via `goodWhenRising`): falling discretionary spending is good (emerald), rising investment contributions good (emerald), rising credit-card growth bad (red).

- [ ] **Step 3: Verify**

Run: `pnpm check`. Browser at 390×844: open /data, screenshot, Read, compare to the Data mockup (conditions card with right-axis chart, 2×2 stats, compare bars with mid tick and red Fixed-Cost bar, 3 trend cards).

- [ ] **Step 4: Commit**

```bash
git add src/app/data
git commit -m "feat: data screen — conditions index, benchmarks, percentile compare (sample data)"
```

---

### Task 11: Full verification + docs

**Files:**
- Modify: `docs/CURRENT_PHASE.md`, `docs/ROADMAP.md`, `docs/KNOWN_LIMITATIONS.md`

- [ ] **Step 1: Reseed and verify all three screens against the mockups**

`pnpm check` green first. Then in the browser (390×844): sign in if needed (existing browse session or the Task-12 `verifyOtp` bootstrap documented in `.superpowers/sdd/task-12-report.md`), open Home → use "clear + reload demo": run `clearDemoData` then `loadDemoData` path by clicking through (or SQL-free route: onboarded user → dashboard → if data exists, the new texture requires reseed — trigger by deleting demo rows via the UI-less path: sign in as a FRESH user via the bootstrap and load demo during onboarding). Screenshot Home / Rankings / Data at 390×844 and 1280×900 (6 screenshots), Read each against its mockup image, and note deviations in the report. Console must be clean on all three routes.

- [ ] **Step 2: Update docs**

- `CURRENT_PHASE.md`: mark the visual-parity slice complete (Home polish, Rankings, Data on sample data); next-three-priorities becomes: (1) Report screen (computed from demo data), (2) manual accounts/transactions CRUD, (3) remaining demo profiles + PWA manifest/Playwright.
- `ROADMAP.md` Phase 1 checklist: check off Rankings screen and Data/benchmarks screen.
- `KNOWN_LIMITATIONS.md`: add — Rankings/Data run on sample cohort data (module `src/lib/demo-data/cohorts.ts`) until Phase 6; league tabs/challenges are static samples; chart stem chips are approximate-positioned (plot-inset constants) and hidden on ranges > 45 days.

- [ ] **Step 3: Final check + commit**

Run: `pnpm check`
Expected: green.

```bash
git add docs
git commit -m "docs: record visual-parity slice (rankings + data screens, home polish)"
```
