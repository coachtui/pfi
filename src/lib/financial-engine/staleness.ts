import type { ISODate } from "./types";
import { daysBetween } from "./snapshot-builder";

/** One statement cycle plus slack. Governs both banner appearance and
 * how long a dismissal suppresses it. */
export const STALE_AFTER_DAYS = 35;

export interface AccountFreshnessInput {
  id: string;
  provider: string;
  includeInCalculations: boolean;
  archived: boolean;
  anchorDate: ISODate | null;
  newestTxnDate: ISODate | null;
}

/** How current this account's data verifiably is: the effective anchor date
 * (the verified point), falling back to the newest transaction date. */
export function accountFreshness(a: AccountFreshnessInput): ISODate | null {
  return a.anchorDate ?? a.newestTxnDate ?? null;
}

/** The household is only as fresh as its least-fresh scoring input: the
 * OLDEST freshness across included, non-archived, non-demo accounts.
 * Demo data has fixed end dates and must never trip wall-clock staleness. */
export function householdFreshness(accounts: AccountFreshnessInput[]): ISODate | null {
  const dates = accounts
    .filter((a) => a.provider !== "demo" && a.includeInCalculations && !a.archived)
    .map(accountFreshness)
    .filter((d): d is ISODate => d !== null);
  if (dates.length === 0) return null;
  return dates.reduce((m, d) => (d < m ? d : m));
}

export function isStale(freshness: ISODate | null, today: ISODate): boolean {
  return freshness !== null && daysBetween(freshness, today) > STALE_AFTER_DAYS;
}

/** Banner rule: stale, and either never dismissed or dismissed more than a
 * full cycle ago. Clears automatically when fresh data arrives (freshness
 * moves forward, isStale flips false). */
export function nudgeVisible(
  freshness: ISODate | null,
  today: ISODate,
  dismissedOn: ISODate | null,
): boolean {
  if (!isStale(freshness, today)) return false;
  if (dismissedOn !== null && daysBetween(dismissedOn, today) <= STALE_AFTER_DAYS) return false;
  return true;
}
