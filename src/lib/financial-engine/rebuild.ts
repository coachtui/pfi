import type { ISODate } from "./types";
import type { SnapshotBuilderConfig, TransactionInput } from "./snapshot-builder";

/** Matches the demo generator's buffer so a rebuild of demo data is identical. */
export const DEFAULT_SAFETY_BUFFER = 2500;

export interface PriorSnapshotMeta {
  date: ISODate;
  safetyBuffer: number;
}

/**
 * Derive the snapshot window for a rebuild from what already exists. The
 * window must never shrink (prior snapshot dates are kept) and must cover
 * every transaction, so adding history extends backward and new activity
 * extends forward. Returns null when there is nothing to build from.
 */
export function deriveRebuildConfig(
  prior: PriorSnapshotMeta[],
  transactions: TransactionInput[],
): SnapshotBuilderConfig | null {
  const dates = [...prior.map((p) => p.date), ...transactions.map((t) => t.postedDate)];
  if (dates.length === 0) return null;
  let start = dates[0];
  let end = dates[0];
  for (const d of dates) {
    if (d < start) start = d;
    if (d > end) end = d;
  }
  const latest = prior.reduce<PriorSnapshotMeta | null>(
    (acc, p) => (acc === null || p.date > acc.date ? p : acc),
    null,
  );
  return { startDate: start, endDate: end, safetyBuffer: latest?.safetyBuffer ?? DEFAULT_SAFETY_BUFFER };
}
