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
