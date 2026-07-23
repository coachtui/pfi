// Resolves a concept's metricKey to display-ready live household figures.
// Slice A implements the report:* namespace only (sufficient for Revenue);
// metric:/snapshot:/position: keys return null and are added by Slices B/C
// as their concepts migrate (spec decision #10).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildIndexSeries,
  buildMetricInputs,
  computeMetrics,
  computePeriodStatement,
  enumeratePeriods,
  formatDollars,
  latestCompletePeriod,
  METRICS,
  type DailySnapshot,
  type FinancialEvent,
  type ReportPeriod,
  type ScoreAccountInput,
  type ScoreTransactionInput,
  type TransactionInput,
} from "@/lib/financial-engine";
// `./queries` carries a top-level `import "server-only"`, which throws as
// soon as the module is evaluated outside a real server-component/runtime
// context (Vitest's plain Node environment has no `react-server` resolve
// condition, so it always hits the throwing branch — see mappers.ts vs.
// queries.ts for the existing pure/impure file split this mirrors). A
// static top-level import here would poison this whole module for the unit
// test above, which only wants the pure `computeReportLive`. Deferring to a
// dynamic import inside the one function that actually needs it keeps
// `computeReportLive` importable in isolation while still loading `queries`
// (module cache means no real perf cost) once this async function actually
// runs in a server context.

export interface ConceptLiveData {
  periodLabel: string;
  display: string;               // formatted current-period value
  priorLabel: string | null;
  priorDisplay: string | null;
  deltaDisplay: string | null;   // e.g. "+$400 vs May 2026"; null without a prior period
}

const REPORT_FIELDS = ["revenue", "operatingExpenses", "freeCashFlow", "savings", "savingsRatePct"] as const;
type ReportField = (typeof REPORT_FIELDS)[number];

/** Pure resolution over already-loaded data — unit-tested; the fetch wrapper below stays thin. */
export function computeReportLive(
  metricKey: string,
  snapshots: DailySnapshot[],
  transactions: TransactionInput[],
  events: FinancialEvent[],
): ConceptLiveData | null {
  const [ns, field] = metricKey.split(":");
  if (ns !== "report" || !REPORT_FIELDS.includes(field as ReportField)) return null;
  if (snapshots.length === 0) return null;

  const indexPoints = buildIndexSeries(snapshots).points;
  const periods = enumeratePeriods(snapshots, "monthly");
  const current = latestCompletePeriod(periods);
  if (!current) return null;

  const statement = computePeriodStatement(snapshots, transactions, events, indexPoints, current);
  const idx = periods.findIndex((p) => p.key === current.key);
  const prior = idx > 0 ? periods[idx - 1]! : null;
  const priorStatement = prior
    ? computePeriodStatement(snapshots, transactions, events, indexPoints, prior)
    : null;

  const f = field as ReportField;
  const isPct = f === "savingsRatePct";
  const fmt = (v: number) => (isPct ? `${v.toFixed(1)}%` : formatDollars(v));
  const value = statement[f];
  const priorValue = priorStatement ? priorStatement[f] : null;

  let deltaDisplay: string | null = null;
  if (priorValue !== null && prior) {
    const delta = value - priorValue;
    const magnitude = isPct ? `${Math.abs(delta).toFixed(1)} pts` : formatDollars(Math.abs(delta));
    deltaDisplay = `${delta >= 0 ? "+" : "−"}${magnitude} vs ${prior.label}`;
  }

  return {
    periodLabel: current.label,
    display: fmt(value),
    priorLabel: prior?.label ?? null,
    priorDisplay: priorValue !== null ? fmt(priorValue) : null,
    deltaDisplay,
  };
}

/** Current + prior complete monthly period ends, or null when unavailable. */
function currentAndPriorPeriods(snapshots: DailySnapshot[]): { current: ReportPeriod; prior: ReportPeriod | null } | null {
  if (snapshots.length === 0) return null;
  const periods = enumeratePeriods(snapshots, "monthly");
  const current = latestCompletePeriod(periods);
  if (!current) return null;
  const idx = periods.findIndex((p) => p.key === current.key);
  return { current, prior: idx > 0 ? periods[idx - 1]! : null };
}

const METRIC_IDS = ["recurring_surplus", "liquid_runway_months", "debt_service_ratio"] as const;

export function computeMetricLive(
  metricKey: string,
  snapshots: DailySnapshot[],
  transactions: ScoreTransactionInput[],
  accounts: ScoreAccountInput[],
): ConceptLiveData | null {
  const [ns, id] = metricKey.split(":");
  if (ns !== "metric" || !METRIC_IDS.includes(id as (typeof METRIC_IDS)[number])) return null;
  const def = METRICS.find((m) => m.id === id);
  if (!def) return null;

  const bounds = currentAndPriorPeriods(snapshots);
  if (!bounds) return null;

  const resultAt = (asOf: string): { value: number; formatted: string } | null => {
    const results = computeMetrics(buildMetricInputs(snapshots, transactions, accounts, asOf));
    const r = results.find((m) => m.id === id);
    if (!r || r.availability !== "available" || r.value === null || r.formatted === null) return null;
    return { value: r.value, formatted: r.formatted };
  };

  const current = resultAt(bounds.current.end);
  if (!current) return null;
  const prior = bounds.prior ? resultAt(bounds.prior.end) : null;

  let deltaDisplay: string | null = null;
  if (prior && bounds.prior) {
    const delta = current.value - prior.value;
    deltaDisplay = `${delta >= 0 ? "+" : "−"}${def.format(Math.abs(delta))} vs ${bounds.prior.label}`;
  }

  return {
    periodLabel: bounds.current.label,
    display: current.formatted,
    priorLabel: bounds.prior?.label ?? null,
    priorDisplay: prior?.formatted ?? null,
    deltaDisplay,
  };
}

export async function getConceptLiveData(
  supabase: SupabaseClient,
  metricKey: string,
): Promise<ConceptLiveData | null> {
  if (!metricKey.startsWith("report:")) return null;
  const { getReportData } = await import("./queries");
  const { snapshots, transactions, events } = await getReportData(supabase);
  return computeReportLive(metricKey, snapshots, transactions, events);
}
