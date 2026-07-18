import { describe, expect, it } from "vitest";
import { generateNorthShore } from "./north-shore";
import { buildDailySnapshots } from "../financial-engine";
import { buildMetricInputs, type ScoreAccountInput } from "../financial-engine/metric-inputs";
import { computeMetrics } from "../financial-engine/metrics";
import { computeConfidence } from "../financial-engine/confidence";
import { computeScore } from "../financial-engine/scoring";

const AS_OF = "2026-07-15";

function toScoreAccounts(dataset: ReturnType<typeof generateNorthShore>): ScoreAccountInput[] {
  return dataset.accounts.map((a) => ({
    id: a.id, type: a.type, institution: a.institution, currentBalance: a.currentBalance,
    creditLimit: a.creditLimit ?? null,
    interestRate: a.interestRate == null ? null : a.interestRate / 100,
    includeInCalculations: a.includeInCalculations, provider: a.provider,
  }));
}

describe("generateNorthShore", () => {
  const dataset = generateNorthShore();
  const snapshots = buildDailySnapshots(dataset.accounts, dataset.transactions, dataset.config);

  it("is deterministic across runs", () => {
    const again = generateNorthShore();
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

  it("is debt-free: no liability accounts, no debt payments", () => {
    const liabilityTypes = new Set(["credit_card", "mortgage", "auto_loan", "student_loan", "personal_loan", "other_liability"]);
    expect(dataset.accounts.some((a) => liabilityTypes.has(a.type))).toBe(false);
    expect(dataset.events.some((e) => e.type === "debt_payment" || e.type === "debt_payoff")).toBe(false);
  });

  it("hits the persona invariants: debt-free rule, concentration penalty, long runway, high band", () => {
    const inputs = buildMetricInputs(snapshots, dataset.transactions, toScoreAccounts(dataset), AS_OF);
    const results = computeMetrics(inputs);
    const confidence = computeConfidence(inputs, results);
    const breakdown = computeScore(results, confidence.byDimension, AS_OF);

    const debt = breakdown.dimensions.find((d) => d.key === "debt")!;
    expect(debt.eligible).toBe(true);
    expect(debt.score).toBe(100); // debt-free rule

    expect(inputs.institutionShares[0]).toBeGreaterThanOrEqual(0.75);
    const concentration = breakdown.dimensions.find((d) => d.key === "concentration")!;
    expect(concentration.eligible).toBe(true);

    const runway = results.find((m) => m.id === "liquid_runway_months")!;
    expect(runway.availability).toBe("available");
    expect(runway.value!).toBeGreaterThanOrEqual(12);

    expect(breakdown.overall).not.toBeNull();
    expect(breakdown.overall!).toBeGreaterThanOrEqual(640); // Strong or Excellent
  });
});
