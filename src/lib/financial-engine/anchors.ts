// src/lib/financial-engine/anchors.ts
import type { ISODate } from "./types";
import { signedNet, type AccountInput, type TransactionInput } from "./snapshot-builder";

/** One (date, balance) truth point for an account. Balance uses the same
 * sign convention as financial_accounts.current_balance (positive-owed for
 * liabilities). Rows are append-only provenance; effectiveAnchor picks the
 * one the engine trusts. */
export interface BalanceAnchor {
  accountId: string;
  anchorDate: ISODate;
  balance: number;
  createdAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The anchor the engine trusts: greatest anchorDate, tiebreak latest
 * createdAt. A back-filled older statement stores its anchor (and still
 * reconciles) without superseding a newer one. */
export function effectiveAnchor(anchors: BalanceAnchor[]): BalanceAnchor | null {
  let best: BalanceAnchor | null = null;
  for (const a of anchors) {
    if (
      best === null ||
      a.anchorDate > best.anchorDate ||
      (a.anchorDate === best.anchorDate && a.createdAt > best.createdAt)
    ) {
      best = a;
    }
  }
  return best;
}

/** Anchor balance plus the net effect of the account's transactions dated
 * strictly after the anchor. The anchor's own date is inside its truth —
 * a statement's ending balance already reflects everything through close. */
export function rollForwardBalance(
  account: AccountInput,
  anchorBalance: number,
  anchorDate: ISODate,
  transactions: TransactionInput[],
): number {
  const after = transactions.filter((t) => t.postedDate > anchorDate);
  return round2(anchorBalance + signedNet(account, after));
}

/** Balance at any date D, derived from an anchor — direction-agnostic:
 * transactions between the anchor and D are added when D is after the
 * anchor, backed out when D is before it (the back-filled-statement case). */
export function derivedBalanceAt(
  account: AccountInput,
  anchor: { balance: number; anchorDate: ISODate },
  date: ISODate,
  transactions: TransactionInput[],
): number {
  if (date >= anchor.anchorDate) {
    const between = transactions.filter((t) => t.postedDate > anchor.anchorDate && t.postedDate <= date);
    return round2(anchor.balance + signedNet(account, between));
  }
  const between = transactions.filter((t) => t.postedDate > date && t.postedDate <= anchor.anchorDate);
  return round2(anchor.balance - signedNet(account, between));
}

/** Reconciliation: entered statement balance minus what the effective anchor
 * plus known transactions say that date's balance should be. Positive means
 * unexplained money appeared; negative, unexplained money left. Null when
 * there is no prior anchor to reconcile against. */
export function computeDiscrepancy(
  account: AccountInput,
  effective: { balance: number; anchorDate: ISODate } | null,
  enteredBalance: number,
  enteredDate: ISODate,
  transactions: TransactionInput[],
): number | null {
  if (!effective) return null;
  return round2(enteredBalance - derivedBalanceAt(account, effective, enteredDate, transactions));
}
