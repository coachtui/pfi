# Visual Parity — Home polish + Rankings + Data screens

Date: 2026-07-15 · Status: approved (user) · Reference: three supplied mockup images (Home, Rankings, Data)

## Goal

Close the visual gap between the running app and the mockups: polish the Home dashboard, and build the Rankings and Data screens on deterministic mock cohort data. The app should look and feel like the mockups at 390px while remaining honest about what is sample data.

## Non-goals

Report screen (stays a stub). Real cohort/benchmark pipeline (Phase 6). Health score (Phase 2). "View all" destinations (render as no-op with `title="Coming soon"`, `cursor-default`). No new DB tables, no engine changes.

## Principles that bind this slice

- Rankings rank by **normalized improvement** (quarterly %), never wealth. The "Performance Score" is a mock normalized score, clearly sample data — never described as the health score or a credit score.
- **Honesty caption:** Rankings and Data each show a subtle caption: "Preview — sample cohort data". Mockups omit it; our principles don't.
- No color-only state: percentile bars pair color with value + percentile text; movement arrows pair direction glyph with signed number.
- Deterministic: all mock cohort data comes from a seeded module; two renders are identical.
- Mobile-first at 390px; verify desktop 1280px after.

## 1. Mock cohort data module

`src/lib/demo-data/cohorts.ts` (framework-free, typed to future Phase 6 shapes):

```ts
export interface LeaderboardEntry {
  rank: number;
  movement: number; // +2 up, -1 down, 0 flat
  companyName: string;
  ticker: string;
  username: string;
  quarterlyChangePct: number; // improvement metric, drives ranking
  icon: "mountain" | "waves" | "palm" | "sprout" | "sun";
  accent: "positive" | "blue" | "orange"; // avatar ring tint
  isViewer?: boolean;
}
export interface LeagueData {
  leagueLabel: string; // "40–49 Age League"
  viewer: { rank: number; percentile: number; performanceScore: number };
  leaderboard: LeaderboardEntry[]; // top 5
}
export type LeagueKey = "age" | "income" | "region" | "overall";
export function getLeagues(): Record<LeagueKey, LeagueData>;

export interface BenchmarkStat {
  label: string;
  value: string;          // "18.6%"
  vsCohort: string;       // "vs cohort 15.2%"
  tone: "positive" | "negative";
  trend: number[];        // sparkline series (seeded)
}
export interface CompareRow {
  label: string;          // "Savings Efficiency"
  viewerValue: string;    // "Koa: 18.6%"
  percentile: number;     // 0–100
  goodDirection: boolean; // false → bar renders negative-toned (e.g. Fixed-Cost Burden 34th)
  icon: "piggy" | "home" | "droplet" | "trend";
}
export interface BenchmarkData {
  conditionsIndex: number;        // 72.4
  conditionsTrend: number[];      // area-chart series (seeded walk)
  conditionsNote: string;         // "Improving this quarter"
  stats: BenchmarkStat[];         // 4 cards
  compare: CompareRow[];          // 4 rows
  trends: Array<{ label: string; changePct: number; trend: number[] }>; // 3 cards
}
export function getBenchmarks(): BenchmarkData;
/** Gamification level is Phase 6; until then it is sample data, sourced here. */
export const VIEWER_LEVEL = 7;
```

Values match the mockups: age league — viewer rank 126, 87th percentile, score 784; leaderboard North Shore Capital $NSHC WaveRider +12.48% (▲2), Blue Reef Partners $BRFP CoralTrader +9.73% (▼1), **Koa Holdings $KOAH IslandBuilder +8.21% (▲5, highlighted)**, Haleiwa Growth $HLGW GreenSeeker +6.34% (▼1), Sunset Wealth $SNWT AlohaFin +5.18% (—). Income/region/overall leagues get plausible seeded variations (different ranks/entries, Koa always present). Benchmarks: index 72.4 improving; stats Median Savings Margin 18.6% vs 15.2% (positive), Users Below Baseline 38% vs 47% (negative-toned), Liquid Runway 3.7mo vs 2.6mo (positive), Debt Pressure +7.2% vs +10.1% (negative-toned); compare Savings Efficiency 18.6%/78th, Fixed-Cost Burden 28.4%/34th (goodDirection false), Liquidity Strength 3.7mo/72nd, Investment Consistency 82%/65th; trends Discretionary Spending −2.4%, Investment Contributions +4.1%, Credit Card Growth +6.8% (red-toned). All series from `mulberry32` with fixed seeds.

## 2. Shared components

- `src/components/chart/Sparkline.tsx` — extracted from MetricCard; props `values`, `tone` (positive/negative/warning/neutral), optional `fill` (gradient under line, used by trend cards), fixed viewBox, `aria-hidden`. MetricCard consumes it.
- `src/components/ui/Segmented.tsx` — extracted from HomeDashboard's range pills; props `options: {key,label}[]`, `value`, `onChange`, `ariaLabel`; same pill styling; `aria-pressed` per option; used by chart ranges AND rankings league tabs.
- `src/components/ui/PercentileBar.tsx` — horizontal track with filled bar (0–100), 50th-percentile tick mark, tone by `goodDirection`; `role="img"` + `aria-label` "78th percentile". Pure width math in a tested helper (`clamp`).
- `src/components/dashboard/TrendStatCard.tsx` — label, big value, sub-line, toned Sparkline with gradient; used by Data stats + cohort trends.

## 3. Home polish

- **Demo texture:** widen daily noise in `koa-holdings.ts` keeping monthly means (essentials 70 ± 50; card spend mean ~20 range 4–36; large purchases p 0.05, amounts 150–450). Existing tests (solvency > 0.7, improving arc, determinism) still bind; tune constants only if they fail, note in commit.
- **Inline line labels:** at the last visible point render "● Actual / ● Baseline / ● Waterline" labels at the right edge (custom svg labels or absolutely-positioned chips vertically placed by last values); remove the bottom legend row; keep sr-only description. Right margin grows to fit (~64px).
- **Labeled event stems:** for ≤4 priority markers in range (paycheck/mortgage/bonus): dashed vertical ReferenceLine from point to axis, plus below-axis chips (icon in tinted circle + label) absolutely positioned at the same x fraction. Positioning helper `markerXFraction(index, count)` unit-tested. Dense ranges (90D+) fall back to current dots.
- **Momentum card:** ascending-bars glyph (4 bars, heights by direction) beside the arrow, per mockup.
- **Header avatar chip:** right side, circular chip (palm icon on gradient) with "LV. 7" pill overlapping bottom. Level comes from `VIEWER_LEVEL` in the cohorts mock module (gamification is Phase 6 sample data), passed through `DashboardIdentity.level`.

## 4. Rankings screen (`/rankings`)

Server component reads profile/company (existing queries) for the header identity; league content from `getLeagues()` via a client component holding tab state. Layout per mockup: title + league sublabel + info icon → `Segmented` tabs (Age/Income/Region/Overall) → viewer card (avatar icon, company/ticker/username + verified badge; stats row Quarterly Rank/Percentile/Performance Score) → "Leaderboard" + "Quarterly Performance ▾" (static label) → 5 rows (rank + movement arrow/number colored+signed, icon avatar with accent ring, name/$ticker/username, +% in emerald, chevron; viewer row emerald-bordered) → "Quarterly Challenges" + View all (no-op) → 3 challenge cards (TrendingUp/CalendarCheck/Shield icons, title, description, footer stat + thin progress bar: Most Improved "Top 10%", Savings Streak "12+ months", Debt Crusher "Top 10%"). Caption: "Preview — sample cohort data".

## 5. Data screen (`/data`)

Server component; profile cohort chips (age/income/region from the user's real profile bands, User/DollarSign/MapPin icons) → Household Financial Conditions card (info icon; "Conditions Index" label; 72.4; emerald "↑ Improving this quarter"; compact Recharts area chart with right-side ticks 40/60/80, ~5 date labels) → 2×2 stat grid of `TrendStatCard`s → "How you compare" card (info icon; "Percentile ▾" static label; 4 rows: tinted icon circle, label + "Koa: value", PercentileBar, percentile text; footer scale 0th/50th/100th) → "Cohort trends" + View all (no-op) → 3 `TrendStatCard`s in horizontal scroll row on mobile (grid on md+). Caption: "Preview — sample cohort data".

## 6. Testing & verification

Unit: cohorts module determinism + shape sanity (leaderboard sorted by quarterlyChangePct desc, ranks contiguous, exactly one isViewer); percentile clamp helper; markerXFraction helper. Existing demo tests keep passing (or constants retuned per §3). `pnpm check` green. Browser verification against the mockup images at 390×844 and 1280×900 for all three screens (side-by-side comparison in the report), console clean.

## 7. Risks

Recharts inline end-labels and below-axis stems are the fiddly parts — both isolated in FinancialChart with pure positioning helpers so failures are contained. Demo-texture retuning may shift snapshot-derived numbers shown on Home (acceptable; deterministic).
