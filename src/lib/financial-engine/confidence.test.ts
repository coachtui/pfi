import { describe, expect, it } from "vitest";
import { computeConfidence } from "./confidence";
import type { MetricInputs } from "./metric-inputs";
import type { MetricResult } from "./score-types";

function inputs(partial: Partial<MetricInputs> = {}): MetricInputs {
  return {
    asOfDate: "2026-07-15", windowStart: "2026-04-17", historyDays: 120,
    buckets: [], totals: { income: 1, spending: 0, essential: 0, contributions: 0, debtPayments: 0 },
    incomeSources: [], recurringIncomeMonthlyAvg: 0, snapshot: null, liquidSeries: [],
    revolvingStart: null, revolvingEnd: null, debtAccounts: [], hasRevolvingAccounts: false,
    revolvingLimitTotal: null, institutionShares: [], accountCount: 2,
    dataQuality: { uncategorizedShare: 0, demo: false, unresolvedTransferShare: 0, manualShare: 0 },
    ...partial,
  };
}

function available(id: string, dimension: MetricResult["dimension"]): MetricResult {
  return { id, name: id, dimension, scored: true, availability: "available", value: 1, formatted: "1", curveScore: null, definition: "d", assumptions: [], limitations: [], reason: null };
}

describe("computeConfidence", () => {
  it("is high everywhere with full history and no gaps", () => {
    const report = computeConfidence(inputs(), [available("m1", "cash_flow")]);
    expect(report.byDimension.cash_flow.level).toBe("high");
    expect(report.improvements).toEqual([]);
  });

  it("caps at moderate under 90 days and limited under 60 days of history", () => {
    expect(computeConfidence(inputs({ historyDays: 80 }), []).byDimension.debt.level).toBe("moderate");
    expect(computeConfidence(inputs({ historyDays: 45 }), []).byDimension.debt.level).toBe("limited");
  });

  it("drops a level when a scored metric is unavailable, with the metric's reason", () => {
    const missing: MetricResult = { ...available("revolving_utilization", "debt"), availability: "unavailable", value: null, reason: "No credit limits on file" };
    const report = computeConfidence(inputs(), [missing]);
    expect(report.byDimension.debt.level).toBe("moderate");
    expect(report.byDimension.debt.reasons).toContain("No credit limits on file");
    expect(report.improvements.length).toBeGreaterThan(0);
  });

  it("does not penalize not_applicable metrics", () => {
    const na: MetricResult = { ...available("debt_service_ratio", "debt"), availability: "not_applicable", value: null, reason: "No debt" };
    expect(computeConfidence(inputs(), [na]).byDimension.debt.level).toBe("high");
  });

  it("penalizes uncategorized transactions only for category-driven dimensions", () => {
    const report = computeConfidence(
      inputs({ dataQuality: { uncategorizedShare: 0.2, demo: false, unresolvedTransferShare: 0, manualShare: 0 } }),
      [],
    );
    expect(report.byDimension.cash_flow.level).toBe("moderate");
    expect(report.byDimension.liquidity.level).toBe("moderate");
  });

  it("caps everything at moderate for demo data", () => {
    const report = computeConfidence(
      inputs({ dataQuality: { uncategorizedShare: 0, demo: true, unresolvedTransferShare: 0, manualShare: 0 } }),
      [],
    );
    for (const dim of Object.values(report.byDimension)) {
      expect(["moderate", "limited"]).toContain(dim.level);
    }
    expect(report.byDimension.cash_flow.reasons).toContain("Demo dataset");
  });

  it("drops a level for transfer-sensitive dimensions when >5% of transfers are unresolved", () => {
    const report = computeConfidence(
      inputs({ dataQuality: { uncategorizedShare: 0, demo: false, unresolvedTransferShare: 0.1, manualShare: 0 } }),
      [],
    );
    expect(report.byDimension.cash_flow.level).toBe("moderate");
    expect(report.byDimension.cash_flow.reasons).toContain("Some transfers could not be matched");
    expect(report.byDimension.stability.level).toBe("moderate");
    expect(report.byDimension.growth.level).toBe("moderate");
    // liquidity/debt/concentration are not transfer-sensitive.
    expect(report.byDimension.liquidity.level).toBe("high");
    expect(report.improvements).toContain("Match or correct unpaired transfers");
  });

  it("does not penalize transfers when the unresolved share is at or below 5%", () => {
    const report = computeConfidence(
      inputs({ dataQuality: { uncategorizedShare: 0, demo: false, unresolvedTransferShare: 0.05, manualShare: 0 } }),
      [],
    );
    expect(report.byDimension.cash_flow.level).toBe("high");
    expect(report.byDimension.cash_flow.reasons).not.toContain("Some transfers could not be matched");
  });

  it("drops a level for every dimension when over 80% of accounts are manually entered", () => {
    const report = computeConfidence(
      inputs({ dataQuality: { uncategorizedShare: 0, demo: false, unresolvedTransferShare: 0, manualShare: 0.9 } }),
      [],
    );
    for (const dim of Object.values(report.byDimension)) {
      expect(dim.level).toBe("moderate");
    }
    expect(report.byDimension.concentration.reasons).toContain("Most data was entered manually");
    expect(report.improvements).toContain("Connect accounts when available to corroborate manual data");
  });

  it("does not penalize manual data at or below the 80% threshold", () => {
    const report = computeConfidence(
      inputs({ dataQuality: { uncategorizedShare: 0, demo: false, unresolvedTransferShare: 0, manualShare: 0.8 } }),
      [],
    );
    expect(report.byDimension.cash_flow.level).toBe("high");
    expect(report.byDimension.cash_flow.reasons).not.toContain("Most data was entered manually");
  });
});

describe("computeConfidence — source reliability (Plaid Slice 1)", () => {
  const clean = { historyIncomplete: false, staleConnectedShare: 0, cachedBalanceStale: false, syncDiscrepancy: false, otherCategoryShare: 0 };

  it("treats a missing sourceReliability block as clean (pre-Plaid fixtures)", () => {
    expect(computeConfidence(inputs(), []).byDimension.cash_flow.level).toBe("high");
  });

  it("history still loading caps every dimension at limited and leads the reasons", () => {
    const report = computeConfidence(inputs({ sourceReliability: { ...clean, historyIncomplete: true } }), []);
    for (const dim of Object.values(report.byDimension)) {
      expect(dim.level).toBe("limited");
      expect(dim.reasons[0]).toBe("Transaction history is still loading from Plaid");
    }
    expect(report.improvements).toContain("Wait for Plaid to finish loading your transaction history, then sync again");
  });

  it("stale or disconnected connected accounts drop every dimension one level", () => {
    const report = computeConfidence(inputs({ sourceReliability: { ...clean, staleConnectedShare: 0.5 } }), []);
    expect(report.byDimension.debt.level).toBe("moderate");
    expect(report.byDimension.growth.reasons).toContain("Some connected accounts are stale or disconnected");
    expect(report.improvements).toContain("Reconnect or sync your bank connections");
  });

  it("a stale cached balance affects balance-driven dimensions only", () => {
    const report = computeConfidence(inputs({ sourceReliability: { ...clean, cachedBalanceStale: true } }), []);
    expect(report.byDimension.liquidity.level).toBe("moderate");
    expect(report.byDimension.debt.level).toBe("moderate");
    expect(report.byDimension.cash_flow.level).toBe("high");
  });

  it("a sync discrepancy affects flow-sensitive dimensions and liquidity", () => {
    const report = computeConfidence(inputs({ sourceReliability: { ...clean, syncDiscrepancy: true } }), []);
    expect(report.byDimension.cash_flow.level).toBe("moderate");
    expect(report.byDimension.liquidity.level).toBe("moderate");
    expect(report.byDimension.concentration.level).toBe("high");
    expect(report.byDimension.cash_flow.reasons).toContain("Some synced transactions may be missing (a balance didn't reconcile)");
  });

  it("heavy Other categorization penalizes category-driven dimensions above 25%", () => {
    expect(computeConfidence(inputs({ sourceReliability: { ...clean, otherCategoryShare: 0.2 } }), []).byDimension.cash_flow.level).toBe("high");
    const report = computeConfidence(inputs({ sourceReliability: { ...clean, otherCategoryShare: 0.4 } }), []);
    expect(report.byDimension.cash_flow.level).toBe("moderate");
    expect(report.byDimension.debt.level).toBe("high");
    expect(report.improvements).toContain("Categorize the transactions marked Other");
  });
});
