/**
 * PFI score metric registry. Declarative: one entry per metric with the
 * consumer-facing name, formula, assumptions, and limitations. Scoring
 * curves live in scoring.ts. Normative: docs/FINANCIAL_HEALTH_SCORE.md.
 */
import { BUCKETS, WINDOW_DAYS, type MetricInputs } from "./metric-inputs";
import type { DimensionKey, MetricResult } from "./score-types";

export type MetricComputation =
  | { value: number }
  | { unavailable: string }
  | { notApplicable: string };

export interface MetricDef {
  id: string;
  name: string;
  dimension: DimensionKey;
  scored: boolean;
  definition: string;
  assumptions: string[];
  limitations: string[];
  format: (value: number) => string;
  compute: (inputs: MetricInputs) => MetricComputation;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const months = (v: number) => `${v.toFixed(1)} mo`;
const ratio = (v: number) => v.toFixed(2);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Coefficient of variation; null when mean is 0. */
function cv(values: number[]): number | null {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

const monthlyIncomeAvg = (i: MetricInputs) => i.totals.income / BUCKETS;
const monthlyEssentialAvg = (i: MetricInputs) => i.totals.essential / BUCKETS;
const NO_INCOME = "No income recorded in the last 90 days";
const fullHistory = (i: MetricInputs) => i.historyDays >= WINDOW_DAYS;

export const METRICS: MetricDef[] = [
  // ── Cash Flow Health ──────────────────────────────────────────────
  {
    id: "net_cash_flow_margin", name: "Monthly surplus margin", dimension: "cash_flow", scored: true,
    definition: "(income − spending) / income over the last 90 days. Spending excludes transfers and money you saved or invested.",
    assumptions: ["Refunds reduce spending", "Savings and investment contributions are not spending"],
    limitations: ["Business and shared-household expenses are treated as ordinary household spending"],
    format: pct,
    compute: (i) => i.totals.income <= 0
      ? { unavailable: NO_INCOME }
      : { value: clamp((i.totals.income - i.totals.spending) / i.totals.income, -1, 1) },
  },
  {
    id: "fixed_cost_ratio", name: "Essential-cost share", dimension: "cash_flow", scored: true,
    definition: "Essential (must-pay) spending as a share of income over the last 90 days.",
    assumptions: ["Uses the transaction 'essential' flag; unflagged spending counts as non-essential"],
    limitations: ["Depends on categorization quality"],
    format: pct,
    compute: (i) => i.totals.income <= 0
      ? { unavailable: NO_INCOME }
      : { value: clamp(i.totals.essential / i.totals.income, 0, 1) },
  },
  {
    id: "expense_volatility", name: "Spending steadiness", dimension: "cash_flow", scored: true,
    definition: "How much monthly spending swings (coefficient of variation across three 30-day periods). Lower is steadier.",
    assumptions: ["Three 30-day periods ending today"],
    limitations: ["Needs a full 90 days of history"],
    format: ratio,
    compute: (i) => {
      if (!fullHistory(i)) return { unavailable: "Needs 90 days of history" };
      const spread = cv(i.buckets.map((b) => Math.max(b.spending, 0)));
      return spread === null ? { unavailable: "No spending recorded" } : { value: clamp(spread, 0, 2) };
    },
  },
  {
    id: "recurring_surplus", name: "Typical monthly surplus", dimension: "cash_flow", scored: false,
    definition: "Median of (income − spending) across the three 30-day periods.",
    assumptions: [], limitations: ["Context only — never affects the score"],
    format: (v) => `$${Math.round(v).toLocaleString("en-US")}`,
    compute: (i) => {
      const nets = i.buckets.map((b) => b.income - b.spending).sort((a, b) => a - b);
      return { value: nets[Math.floor(nets.length / 2)] };
    },
  },
  // ── Liquidity & Resilience ────────────────────────────────────────
  {
    id: "liquid_runway_months", name: "Emergency runway", dimension: "liquidity", scored: true,
    definition: "How many months of essential expenses your liquid accounts (checking, savings, money market) could cover.",
    assumptions: ["Retirement, brokerage, and property never count as liquid"],
    limitations: ["Essential expenses come from flagged transactions in the last 90 days"],
    format: months,
    compute: (i) => {
      if (i.snapshot === null) return { unavailable: "No balance history yet" };
      const essential = monthlyEssentialAvg(i);
      if (essential <= 0) return { unavailable: "No essential expenses recorded in the last 90 days" };
      return { value: clamp(i.snapshot.liquidAssets / essential, 0, 60) };
    },
  },
  {
    id: "obligation_coverage", name: "Near-term bill coverage", dimension: "liquidity", scored: true,
    definition: "Liquid assets divided by obligations due before your next expected income.",
    assumptions: ["Obligations come from the daily snapshot engine"],
    limitations: [],
    format: ratio,
    compute: (i) => {
      if (i.snapshot === null) return { unavailable: "No balance history yet" };
      return { value: clamp(i.snapshot.liquidAssets / Math.max(i.snapshot.nearTermObligations, 1), 0, 10) };
    },
  },
  {
    id: "cash_drawdown", name: "Cash-balance stability", dimension: "liquidity", scored: true,
    definition: "The largest peak-to-trough drop in your liquid balances over the last 90 days, as a share of the peak.",
    assumptions: [], limitations: ["Needs at least two days of balance history"],
    format: pct,
    compute: (i) => {
      if (i.liquidSeries.length < 2) return { unavailable: "Not enough balance history" };
      let peak = i.liquidSeries[0];
      let worst = 0;
      for (const v of i.liquidSeries) {
        peak = Math.max(peak, v);
        if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
      }
      return { value: clamp(worst, 0, 1) };
    },
  },
  // ── Debt Health ───────────────────────────────────────────────────
  {
    id: "debt_service_ratio", name: "Debt burden", dimension: "debt", scored: true,
    definition: "Debt payments (loans and credit cards, excluding housing) as a share of income over the last 90 days.",
    assumptions: ["Housing costs are measured by essential-cost share, not here (counted once)"],
    limitations: ["Principal and interest are not separated"],
    format: pct,
    compute: (i) => {
      if (i.debtAccounts.length === 0 && i.totals.debtPayments === 0) return { notApplicable: "No debt — nothing to service" };
      if (i.totals.income <= 0) return { unavailable: NO_INCOME };
      return { value: clamp(i.totals.debtPayments / i.totals.income, 0, 1) };
    },
  },
  {
    id: "revolving_utilization", name: "Credit utilization", dimension: "debt", scored: true,
    definition: "Credit-card balances as a share of total credit limits.",
    assumptions: ["Uses current limits on file"],
    limitations: ["Unavailable until credit limits are recorded"],
    format: pct,
    compute: (i) => {
      if (!i.hasRevolvingAccounts) return { notApplicable: "No credit cards" };
      if (i.revolvingLimitTotal === null) return { unavailable: "No credit limits on file" };
      // Never fabricate a $0 balance when there's simply no balance history yet.
      if (i.snapshot === null) return { unavailable: "No balance history yet" };
      return { value: clamp(i.snapshot.revolvingBalances / i.revolvingLimitTotal, 0, 1.5) };
    },
  },
  {
    id: "weighted_interest_burden", name: "Interest drag", dimension: "debt", scored: true,
    definition: "Estimated monthly interest across your debts as a share of monthly income. High-rate revolving debt weighs heaviest.",
    assumptions: ["Uses interest rates on file; estimated as balance × APR / 12"],
    limitations: ["Unavailable until interest rates are recorded"],
    format: pct,
    compute: (i) => {
      if (i.debtAccounts.length === 0) return { notApplicable: "No debt" };
      if (i.totals.income <= 0) return { unavailable: NO_INCOME };
      const rated = i.debtAccounts.filter((d) => d.rate !== null);
      if (rated.length === 0) return { unavailable: "No interest rates on file" };
      const monthlyInterest = rated.reduce((sum, d) => sum + d.balance * (d.rate ?? 0), 0) / 12;
      return { value: clamp(monthlyInterest / monthlyIncomeAvg(i), 0, 1) };
    },
  },
  {
    id: "revolving_trajectory", name: "Card-balance direction", dimension: "debt", scored: true,
    definition: "How your credit-card balances moved over the last 90 days, relative to monthly income. Falling balances score higher.",
    assumptions: [], limitations: [],
    format: pct,
    compute: (i) => {
      if (!i.hasRevolvingAccounts) return { notApplicable: "No credit cards" };
      if (i.revolvingStart === null || i.revolvingEnd === null) return { unavailable: "Not enough balance history" };
      if (i.totals.income <= 0) return { unavailable: NO_INCOME };
      return { value: clamp((i.revolvingEnd - i.revolvingStart) / monthlyIncomeAvg(i), -2, 2) };
    },
  },
  // ── Stability ─────────────────────────────────────────────────────
  {
    id: "income_consistency", name: "Income consistency", dimension: "stability", scored: true,
    definition: "How much monthly income swings (coefficient of variation across three 30-day periods). Lower is steadier.",
    assumptions: ["One-time income is included, never smoothed"],
    limitations: ["Needs a full 90 days of history", "Salaried vs self-employed patterns are not yet distinguished"],
    format: ratio,
    compute: (i) => {
      if (!fullHistory(i)) return { unavailable: "Needs 90 days of history" };
      const spread = cv(i.buckets.map((b) => b.income));
      return spread === null ? { unavailable: NO_INCOME } : { value: clamp(spread, 0, 2) };
    },
  },
  {
    id: "recurring_income_coverage", name: "Reliable-income coverage", dimension: "stability", scored: true,
    definition: "Average monthly income from repeating sources, divided by average monthly essential expenses.",
    assumptions: ["A source is 'repeating' when it appears in at least two of the three 30-day periods"],
    limitations: [],
    format: ratio,
    compute: (i) => {
      const essential = monthlyEssentialAvg(i);
      if (essential <= 0) return { unavailable: "No essential expenses recorded in the last 90 days" };
      return { value: clamp(i.recurringIncomeMonthlyAvg / essential, 0, 10) };
    },
  },
  {
    id: "irregular_income_reliance", name: "One-off income reliance", dimension: "stability", scored: true,
    definition: "The share of your income that came from non-repeating sources in the last 90 days.",
    assumptions: [], limitations: [],
    format: pct,
    compute: (i) => {
      if (i.totals.income <= 0) return { unavailable: NO_INCOME };
      const recurring = i.incomeSources.filter((s) => s.recurring).reduce((sum, s) => sum + s.total, 0);
      return { value: clamp(1 - recurring / i.totals.income, 0, 1) };
    },
  },
  // ── Growth ────────────────────────────────────────────────────────
  {
    id: "contribution_rate", name: "Contribution rate", dimension: "growth", scored: true,
    definition: "Money you moved into savings and investments as a share of income over the last 90 days. Only your own contributions count — market gains never move this.",
    assumptions: ["Transfers into brokerage/retirement accounts and 'savings'-categorized outflows count as contributions"],
    limitations: ["Debt principal reduction is not yet counted (no principal/interest split)"],
    format: pct,
    compute: (i) => i.totals.income <= 0
      ? { unavailable: NO_INCOME }
      : { value: clamp(i.totals.contributions / i.totals.income, 0, 1) },
  },
  {
    id: "contribution_consistency", name: "Contribution consistency", dimension: "growth", scored: true,
    definition: "In how many of the last three 30-day periods you made at least one contribution.",
    assumptions: [], limitations: [],
    format: (v) => `${Math.round(v * BUCKETS)} of ${BUCKETS} months`,
    compute: (i) => ({ value: i.buckets.filter((b) => b.contributions > 0).length / BUCKETS }),
  },
  // ── Concentration ─────────────────────────────────────────────────
  {
    id: "institution_concentration", name: "Institution concentration", dimension: "concentration", scored: true,
    definition: "The largest share of your custodial asset balances (bank/brokerage/retirement accounts) held at a single institution.",
    assumptions: ["Positive balances only", "Non-custodial assets like property are excluded"],
    limitations: ["Investment holdings (single stocks, sectors) are not yet analyzed"],
    format: pct,
    compute: (i) => i.institutionShares.length === 0
      ? { unavailable: "Needs at least two custodial accounts with balances" }
      : { value: i.institutionShares[0] },
  },
  {
    id: "income_source_concentration", name: "Income-source concentration", dimension: "concentration", scored: true,
    definition: "The share of your income coming from your largest source. One steady job is normal — irregularity is measured separately.",
    assumptions: [], limitations: [],
    format: pct,
    compute: (i) => {
      if (i.totals.income <= 0 || i.incomeSources.length === 0) return { unavailable: NO_INCOME };
      return { value: clamp(i.incomeSources[0].total / i.totals.income, 0, 1) };
    },
  },
];

export function computeMetrics(inputs: MetricInputs): MetricResult[] {
  return METRICS.map((def) => {
    const outcome = def.compute(inputs);
    const base = {
      id: def.id, name: def.name, dimension: def.dimension, scored: def.scored,
      definition: def.definition, assumptions: def.assumptions, limitations: def.limitations,
      curveScore: null, // filled in by scoring.ts for scored, available metrics
    };
    if ("value" in outcome) {
      return { ...base, availability: "available" as const, value: outcome.value, formatted: def.format(outcome.value), reason: null };
    }
    if ("unavailable" in outcome) {
      return { ...base, availability: "unavailable" as const, value: null, formatted: null, reason: outcome.unavailable };
    }
    return { ...base, availability: "not_applicable" as const, value: null, formatted: null, reason: outcome.notApplicable };
  });
}
