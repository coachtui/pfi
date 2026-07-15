import type {
  DailySnapshot,
  Driver,
  FinancialEvent,
  ISODate,
  Momentum,
  PositionStatus,
} from "./types";
import { availablePosition, waterline } from "./position";

/**
 * Deterministic driver calculation: which financial events moved the
 * available position within a date range, largest absolute impact first.
 * This structured output is what the AI explanation layer will narrate —
 * AI never invents drivers. See docs/AI_RECOMMENDATION_POLICY.md.
 */
export function computeDrivers(
  events: FinancialEvent[],
  range: { start: ISODate; end: ISODate },
  limit = 4,
): Driver[] {
  return events
    .filter((e) => e.date >= range.start && e.date <= range.end)
    .map((e) => ({ event: e, impact: e.direction === "inflow" ? e.amount : -e.amount }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, limit);
}

/**
 * Event types that reduce cash but build owner-created equity (investment
 * contributions, full debt payoffs). The engine keeps the honest cash impact
 * in `Driver.impact`; the display layer presents these as equity-positive so
 * users are never discouraged from saving. Routine debt payments still show
 * as cash outflows.
 */
const EQUITY_BUILDING_TYPES: ReadonlySet<FinancialEvent["type"]> = new Set([
  "investment_contribution",
  "debt_payoff",
]);

export interface DriverDisplay {
  /** Signed amount to show. Positive for inflows and equity-building outflows. */
  displayAmount: number;
  tone: "positive" | "negative";
  buildsEquity: boolean;
}

export function driverDisplay(driver: Driver): DriverDisplay {
  const buildsEquity = EQUITY_BUILDING_TYPES.has(driver.event.type);
  if (buildsEquity) {
    return { displayAmount: Math.abs(driver.impact), tone: "positive", buildsEquity };
  }
  return {
    displayAmount: driver.impact,
    tone: driver.impact >= 0 ? "positive" : "negative",
    buildsEquity,
  };
}

const MOMENTUM_STABLE_BAND = 1.0; // index points

/**
 * Momentum: average of the most recent `windowDays` of the indexed actual
 * series vs the average of the `windowDays` before that. Within ±1 index
 * point is "stable" so day-to-day noise is not labeled a trend.
 */
export function computeMomentum(indexedActuals: number[], windowDays = 7): Momentum {
  if (indexedActuals.length < windowDays * 2) {
    return { direction: "stable", delta: 0, windowDays };
  }
  const recent = indexedActuals.slice(-windowDays);
  const prior = indexedActuals.slice(-windowDays * 2, -windowDays);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const delta = avg(recent) - avg(prior);
  const direction =
    delta > MOMENTUM_STABLE_BAND ? "improving" : delta < -MOMENTUM_STABLE_BAND ? "declining" : "stable";
  return { direction, delta: Math.round(delta * 100) / 100, windowDays };
}

/**
 * Position status. Keeps the two distinct conditions separate:
 * below the personal baseline (own average) is NOT the same as being
 * below the waterline (unable to cover near-term essentials + buffer).
 */
export function computeStatus(
  snapshot: DailySnapshot,
  baselineDollars: number | null,
): PositionStatus {
  const pos = availablePosition(snapshot);
  const wl = waterline(snapshot);
  const compare = (a: number, b: number): "above" | "below" | "at" =>
    a > b ? "above" : a < b ? "below" : "at";
  return {
    vsBaseline: baselineDollars === null ? "at" : compare(pos, baselineDollars),
    vsWaterline: compare(pos, wl),
  };
}
