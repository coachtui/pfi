import {
  availablePosition,
  buildIndexSeries,
  computeDivergence,
  computeDrivers,
  computeMomentum,
  cushion,
  driverDisplay,
  indexDayChange,
  waterline,
  type DailySnapshot,
  type FinancialEvent,
  type MomentumState,
} from "@/lib/financial-engine";
import {
  BRIEF_SURFACE,
  briefInputSchema,
  DIVERGENCE_SURFACE,
  DRIVER_EXPLANATIONS_SURFACE,
  driverExplanationsInputSchema,
  type BriefInput,
  type DivergenceInput,
  type DriverExplanationsInput,
} from "./schemas";

/** Matches the dashboard's default 30D view. */
const NARRATION_WINDOW_DAYS = 30;

export interface NarrationSource {
  companyName: string;
  snapshots: DailySnapshot[];
  events: FinancialEvent[];
  score: { overall: number | null; band: string | null; momentum: string } | null;
}

interface WindowDrivers {
  periodDays: number;
  driverInputs: BriefInput["drivers"];
}

/**
 * Shared 30-day window + driver mapping used by BOTH builders. Positional
 * ids over computeDrivers' sorted order — the accordion UI matches its own
 * computeDrivers output to these by index, which is only sound because both
 * surfaces derive from this single function.
 */
function windowDrivers(source: NarrationSource): WindowDrivers | null {
  const { snapshots, events } = source;
  if (snapshots.length === 0) return null;
  const { points } = buildIndexSeries(snapshots);
  if (points.length === 0) return null;
  const visible = points.slice(-NARRATION_WINDOW_DAYS);
  const drivers = computeDrivers(events, {
    start: visible[0].date,
    end: visible[visible.length - 1].date,
  });
  const cents = (n: number) => Math.round(n * 100) / 100;
  return {
    periodDays: visible.length,
    driverInputs: drivers.map((d, i) => ({
      id: `d${i + 1}`,
      kind: d.event.type,
      date: d.event.date,
      impact: cents(d.impact),
      buildsEquity: driverDisplay(d).buildsEquity,
    })),
  };
}

/**
 * Deterministic assembly of the AI data boundary from engine outputs.
 * Deliberately maps drivers to event TYPE only — FinancialEvent.label and
 * event ids never cross the boundary. Final .parse() guarantees the result
 * conforms to the strict schema at runtime, not just at the type level.
 */
export function buildBriefInput(source: NarrationSource): BriefInput | null {
  const { snapshots } = source;
  if (snapshots.length === 0) return null;
  const { points } = buildIndexSeries(snapshots);
  if (points.length === 0) return null;

  const window = windowDrivers(source);
  if (!window) return null;

  const latest = snapshots[snapshots.length - 1];
  const latestPoint = points[points.length - 1];
  const momentum = computeMomentum(points.map((p) => p.actual));

  const compare = (a: number, b: number): "above" | "below" | "at" =>
    a > b ? "above" : a < b ? "below" : "at";
  const cents = (n: number) => Math.round(n * 100) / 100;

  return briefInputSchema.parse({
    surface: BRIEF_SURFACE,
    companyName: source.companyName,
    periodDays: window.periodDays,
    availableCapital: cents(availablePosition(latest)),
    cushion: cents(cushion(latest)),
    vsBaseline:
      latestPoint.baseline === null
        ? "unknown"
        : compare(latestPoint.actual, latestPoint.baseline),
    vsWaterline: compare(availablePosition(latest), waterline(latest)),
    momentum: {
      direction: momentum.direction,
      delta: Math.round(momentum.delta * 10) / 10,
      windowDays: momentum.windowDays,
    },
    drivers: window.driverInputs,
    score: source.score,
  });
}

/**
 * Deterministic assembly of the AI data boundary for the driver_explanations
 * surface. Shares its 30-day window and positional driver ids with
 * buildBriefInput via windowDrivers so the dashboard's driver-card-to-
 * explanation matching (by index) can never silently drift between the two
 * surfaces.
 */
export function buildDriverExplanationsInput(
  source: NarrationSource,
): DriverExplanationsInput | null {
  const window = windowDrivers(source);
  if (!window || window.driverInputs.length === 0) return null;
  const cents = (n: number) => Math.round(n * 100) / 100;
  const totalInflow = window.driverInputs
    .filter((d) => d.impact > 0)
    .reduce((s, d) => s + d.impact, 0);
  const totalOutflow = window.driverInputs
    .filter((d) => d.impact < 0)
    .reduce((s, d) => s + Math.abs(d.impact), 0);
  const netImpact = window.driverInputs.reduce((s, d) => s + d.impact, 0);
  return driverExplanationsInputSchema.parse({
    surface: DRIVER_EXPLANATIONS_SURFACE,
    companyName: source.companyName,
    periodDays: window.periodDays,
    totalInflow: cents(totalInflow),
    totalOutflow: cents(totalOutflow),
    netImpact: cents(netImpact),
    drivers: window.driverInputs,
  });
}

/**
 * Divergence input: null unless the PFI "Today" delta and the Fundamentals
 * Score momentum clash in sign. Score-suppressed sources (score === null) never
 * diverge. Recomputes via the same pure detector page.tsx uses, so they agree.
 */
export function buildDivergenceInput(source: NarrationSource): DivergenceInput | null {
  if (!source.score) return null;
  const points = buildIndexSeries(source.snapshots).points;
  if (points.length < 2) return null;
  const today = indexDayChange(points[points.length - 1].actual, points[points.length - 2]?.actual).points;
  const momentum = source.score.momentum as MomentumState;
  const result = computeDivergence(today, momentum);
  if (!result) return null;
  return {
    surface: DIVERGENCE_SURFACE,
    companyName: source.companyName,
    direction: result.direction,
    scoreMomentum: momentum,
  };
}
