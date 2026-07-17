import { describe, expect, it } from "vitest";
import { buildMetricInputs, type MetricInputs, type ScoreAccountInput, type ScoreTransactionInput } from "./metric-inputs";
import { METRICS, computeMetrics } from "./metrics";
import type { DailySnapshot } from "./types";

const AS_OF = "2026-07-15";

const ACCOUNTS: ScoreAccountInput[] = [
  { id: "chk", type: "checking", institution: "First Bank", currentBalance: 9000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "sav", type: "savings", institution: "Ally", currentBalance: 6000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
  { id: "card", type: "credit_card", institution: "First Bank", currentBalance: 3000, creditLimit: 10000, interestRate: 0.24, includeInCalculations: true, provider: "manual" },
];

function snap(date: string, liquid: number, revolving = 3000): DailySnapshot {
  return { date, liquidAssets: liquid, revolvingBalances: revolving, nearTermObligations: 3000, essentialObligations: 2000, safetyBuffer: 1000, netWorth: 12000 };
}

/** ~4 months of history: monthly payroll, rent, groceries, card payment. */
function healthyFixture(): { snapshots: DailySnapshot[]; txns: ScoreTransactionInput[] } {
  const txns: ScoreTransactionInput[] = [];
  const snapshots: DailySnapshot[] = [];
  const base = { accountId: "chk", category: null as string | null, essential: null as boolean | null, isTransfer: false, transferPairId: null, description: "" };
  const months = ["2026-04", "2026-05", "2026-06", "2026-07"];
  months.forEach((m, i) => {
    txns.push({ ...base, id: `pay${i}`, postedDate: `${m}-01`, amount: 6000, direction: "inflow", category: "income", description: "Employer payroll" });
    txns.push({ ...base, id: `rent${i}`, postedDate: `${m}-02`, amount: 1800, direction: "outflow", category: "housing", essential: true });
    txns.push({ ...base, id: `gro${i}`, postedDate: `${m}-10`, amount: 700, direction: "outflow", category: "groceries", essential: true });
    txns.push({ ...base, id: `fun${i}`, postedDate: `${m}-12`, amount: 500, direction: "outflow", category: "discretionary", essential: false });
    txns.push({ ...base, id: `dpo${i}`, postedDate: `${m}-15`, amount: 400, direction: "outflow", isTransfer: true, transferPairId: `dpi${i}` });
    txns.push({ ...base, id: `dpi${i}`, postedDate: `${m}-15`, amount: 400, direction: "inflow", accountId: "card", isTransfer: true, transferPairId: `dpo${i}` });
  });
  for (let d = 0; d < 106; d++) {
    const date = new Date(Date.UTC(2026, 3, 1 + d)).toISOString().slice(0, 10);
    if (date > AS_OF) break;
    snapshots.push(snap(date, 12000 + d * 20));
  }
  return { snapshots, txns };
}

function inputsFor(overrides?: { accounts?: ScoreAccountInput[]; txns?: ScoreTransactionInput[] }): MetricInputs {
  const fx = healthyFixture();
  return buildMetricInputs(fx.snapshots, overrides?.txns ?? fx.txns, overrides?.accounts ?? ACCOUNTS, AS_OF);
}

describe("METRICS registry", () => {
  it("has 17 scored metrics with valid dimensions and required documentation", () => {
    const scored = METRICS.filter((m) => m.scored);
    expect(scored).toHaveLength(17);
    for (const m of METRICS) {
      expect(m.definition.length).toBeGreaterThan(10);
      expect(["cash_flow", "liquidity", "debt", "stability", "growth", "concentration"]).toContain(m.dimension);
    }
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
  });
});

describe("computeMetrics", () => {
  it("computes healthy-fixture values", () => {
    const results = computeMetrics(inputsFor());
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    // window covers payroll for buckets: income 6000×3 = 18000, spending 3000×3 = 9000
    expect(by.net_cash_flow_margin.value).toBeCloseTo(0.5, 1);
    expect(by.fixed_cost_ratio.value).toBeCloseTo(2500 * 3 / 18000, 1);
    expect(by.liquid_runway_months.availability).toBe("available");
    expect(by.debt_service_ratio.value).toBeCloseTo(1200 / 18000, 2);
    expect(by.revolving_utilization.value).toBeCloseTo(0.3, 1);
    expect(by.income_consistency.availability).toBe("available");
    expect(by.institution_concentration.availability).toBe("available");
  });

  it("guards zero income: income-denominated metrics unavailable, never Infinity", () => {
    const results = computeMetrics(inputsFor({ txns: [] }));
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    for (const id of ["net_cash_flow_margin", "fixed_cost_ratio", "debt_service_ratio", "contribution_rate", "income_source_concentration"]) {
      expect(by[id].availability, id).toBe("unavailable");
      expect(by[id].curveScore, id).toBeNull();
    }
  });

  it("marks debt metrics not_applicable for a debt-free household", () => {
    const noDebt = ACCOUNTS.filter((a) => a.type !== "credit_card");
    const fx = healthyFixture();
    const txns = fx.txns.filter((t) => t.accountId !== "card" && !t.transferPairId?.startsWith("dpi"));
    const results = computeMetrics(buildMetricInputs(fx.snapshots.map((s) => ({ ...s, revolvingBalances: 0 })), txns, noDebt, AS_OF));
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by.debt_service_ratio.availability).toBe("not_applicable");
    expect(by.revolving_utilization.availability).toBe("not_applicable");
    expect(by.weighted_interest_burden.availability).toBe("not_applicable");
  });

  it("marks utilization unavailable (not fabricated) when limits are missing", () => {
    const noLimit = ACCOUNTS.map((a) => a.type === "credit_card" ? { ...a, creditLimit: null } : a);
    const by = Object.fromEntries(computeMetrics(inputsFor({ accounts: noLimit })).map((r) => [r.id, r]));
    expect(by.revolving_utilization.availability).toBe("unavailable");
    expect(by.revolving_utilization.reason).toMatch(/limit/i);
  });

  it("marks utilization unavailable (never a fabricated $0 balance) when there's no balance history", () => {
    const fx = healthyFixture();
    const by = Object.fromEntries(
      computeMetrics(buildMetricInputs([], fx.txns, ACCOUNTS, AS_OF)).map((r) => [r.id, r]),
    );
    expect(by.revolving_utilization.availability).toBe("unavailable");
    expect(by.revolving_utilization.reason).toMatch(/balance history/i);
  });

  it("requires full 90-day history for volatility/consistency metrics", () => {
    const fx = healthyFixture();
    const shortSnaps = fx.snapshots.slice(-40); // ~40 days of history
    const results = computeMetrics(buildMetricInputs(shortSnaps, fx.txns, ACCOUNTS, AS_OF));
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by.expense_volatility.availability).toBe("unavailable");
    expect(by.income_consistency.availability).toBe("unavailable");
  });
});
