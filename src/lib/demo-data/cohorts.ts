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
