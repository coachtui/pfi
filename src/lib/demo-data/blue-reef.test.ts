import { describe, expect, it } from "vitest";
import { generateBlueReef } from "./blue-reef";
import { buildDailySnapshots, availablePosition } from "../financial-engine";
import { buildMetricInputs, type ScoreAccountInput } from "../financial-engine/metric-inputs";
import { computeMetrics } from "../financial-engine/metrics";
import { computeConfidence } from "../financial-engine/confidence";
import { computeScore } from "../financial-engine/scoring";

const AS_OF = "2026-07-15";

function toScoreAccounts(dataset: ReturnType<typeof generateBlueReef>): ScoreAccountInput[] {
  return dataset.accounts.map((a) => ({
    id: a.id, type: a.type, institution: a.institution, currentBalance: a.currentBalance,
    creditLimit: a.creditLimit ?? null,
    // account records store percent; the read boundary divides by 100
    interestRate: a.interestRate == null ? null : a.interestRate / 100,
    includeInCalculations: a.includeInCalculations, provider: a.provider,
  }));
}

describe("generateBlueReef", () => {
  const dataset = generateBlueReef();
  const snapshots = buildDailySnapshots(dataset.accounts, dataset.transactions, dataset.config);

  it("is deterministic across runs", () => {
    const again = generateBlueReef();
    expect(again.accounts).toEqual(dataset.accounts);
    expect(again.transactions).toEqual(dataset.transactions);
    expect(again.events).toEqual(dataset.events);
  });

  it("produces 430 days of snapshots ending 2026-07-15, ascending", () => {
    expect(snapshots).toHaveLength(430);
    expect(snapshots[snapshots.length - 1].date).toBe("2026-07-15");
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].date > snapshots[i - 1].date).toBe(true);
    }
  });

  it("transfer pairs are symmetric and self-consistent", () => {
    const byId = new Map(dataset.transactions.map((t) => [t.id, t]));
    const transfers = dataset.transactions.filter((t) => t.isTransfer);
    expect(transfers.length).toBeGreaterThan(0);
    for (const t of transfers) {
      const pair = byId.get(t.transferPairId!);
      expect(pair).toBeDefined();
      expect(pair!.transferPairId).toBe(t.id);
      expect(pair!.amount).toBe(t.amount);
      expect(pair!.direction).not.toBe(t.direction);
    }
  });

  it("dips below the waterline on at least some days (persona: under strain)", () => {
    const below = snapshots.filter(
      (s) => availablePosition(s) < s.essentialObligations + s.safetyBuffer,
    );
    expect(below.length).toBeGreaterThan(0);
  });

  it("carries a credit limit and APRs so debt metrics are scorable", () => {
    const card = dataset.accounts.find((a) => a.type === "credit_card")!;
    expect(card.creditLimit).toBeGreaterThan(0);
    expect(card.currentBalance / card.creditLimit!).toBeGreaterThanOrEqual(0.75);
    expect(card.interestRate).toBeGreaterThan(20); // percent
  });

  it("scores in a low band with Growth eligible-but-low (persona invariants)", () => {
    const inputs = buildMetricInputs(snapshots, dataset.transactions, toScoreAccounts(dataset), AS_OF);
    const results = computeMetrics(inputs);
    const confidence = computeConfidence(inputs, results);
    const breakdown = computeScore(results, confidence.byDimension, AS_OF);

    expect(breakdown.overall).not.toBeNull();
    expect(breakdown.overall!).toBeLessThan(500); // Building or Needs attention

    const util = results.find((m) => m.id === "revolving_utilization")!;
    expect(util.availability).toBe("available");
    expect(util.value!).toBeGreaterThanOrEqual(0.75);

    const growth = breakdown.dimensions.find((d) => d.key === "growth")!;
    expect(growth.eligible).toBe(true);
    expect(growth.score!).toBeLessThanOrEqual(40);
  });
});
