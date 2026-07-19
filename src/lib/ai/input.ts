import {
  availablePosition,
  buildIndexSeries,
  computeDrivers,
  computeMomentum,
  cushion,
  driverDisplay,
  waterline,
  type DailySnapshot,
  type FinancialEvent,
} from "@/lib/financial-engine";
import { NARRATION_SURFACE, narrationInputSchema, type NarrationInput } from "./schemas";

/** Matches the dashboard's default 30D view. */
const NARRATION_WINDOW_DAYS = 30;

export interface NarrationSource {
  companyName: string;
  snapshots: DailySnapshot[];
  events: FinancialEvent[];
  score: { overall: number | null; band: string | null; momentum: string } | null;
}

/**
 * Deterministic assembly of the AI data boundary from engine outputs.
 * Deliberately maps drivers to event TYPE only — FinancialEvent.label and
 * event ids never cross the boundary. Final .parse() guarantees the result
 * conforms to the strict schema at runtime, not just at the type level.
 */
export function buildNarrationInput(source: NarrationSource): NarrationInput | null {
  const { snapshots, events } = source;
  if (snapshots.length === 0) return null;
  const { points } = buildIndexSeries(snapshots);
  if (points.length === 0) return null;

  const latest = snapshots[snapshots.length - 1];
  const latestPoint = points[points.length - 1];
  const visible = points.slice(-NARRATION_WINDOW_DAYS);
  const momentum = computeMomentum(points.map((p) => p.actual));
  const drivers = computeDrivers(events, {
    start: visible[0].date,
    end: visible[visible.length - 1].date,
  });

  const compare = (a: number, b: number): "above" | "below" | "at" =>
    a > b ? "above" : a < b ? "below" : "at";
  const cents = (n: number) => Math.round(n * 100) / 100;

  return narrationInputSchema.parse({
    surface: NARRATION_SURFACE,
    companyName: source.companyName,
    periodDays: visible.length,
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
    drivers: drivers.map((d, i) => ({
      id: `d${i + 1}`,
      kind: d.event.type,
      date: d.event.date,
      impact: cents(d.impact),
      buildsEquity: driverDisplay(d).buildsEquity,
    })),
    score: source.score,
  });
}
