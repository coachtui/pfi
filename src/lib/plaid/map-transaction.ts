/**
 * Plaid transaction → PFI provider-owned columns (spec §5/§6). Pure.
 *
 * Sign convention: Plaid reports a positive amount for money leaving the
 * account (a purchase on a card, a debit on checking) and negative for money
 * arriving. PFI stores a non-negative `amount` plus `direction`; the
 * liability-side inversion lives ONLY in snapshot-builder's `signedNet`, so a
 * card purchase is an `outflow` here exactly like a checking debit.
 */
import { mapCategory } from "./map-category";
import type { CategoryConfidence, PlaidTransactionShape, ProviderColumns } from "./types";

/** Exact provider-owned column set — the test enumerates these keys against spec §6. */
export const PROVIDER_COLUMNS = [
  "posted_date", "authorized_date", "amount", "direction", "description", "category",
  "category_confidence", "pfc_primary", "pfc_detailed", "category_taxonomy_version",
] as const satisfies readonly (keyof ProviderColumns)[];

const CONFIDENCE: Record<string, CategoryConfidence> = {
  VERY_HIGH: "very_high",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  UNKNOWN: "unknown",
};

export function mapCategoryConfidence(level: string | null): CategoryConfidence {
  return CONFIDENCE[(level ?? "").toUpperCase()] ?? "unknown";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Provider-owned columns for a posted transaction. Throws on a pending
 * transaction — callers filter those out first (spec: posted-only).
 */
export function toProviderColumns(txn: PlaidTransactionShape): ProviderColumns {
  if (txn.pending) throw new Error("toProviderColumns: pending transactions are never ingested");
  const pfc = txn.personalFinanceCategory;
  const description = (txn.merchantName ?? "").trim() || txn.name.trim() || "Transaction";
  return {
    posted_date: txn.date,
    authorized_date: txn.authorizedDate,
    amount: round2(Math.abs(txn.amount)),
    direction: txn.amount >= 0 ? "outflow" : "inflow",
    description,
    category: mapCategory(txn.taxonomyVersion, pfc?.primary ?? null, pfc?.detailed ?? null),
    category_confidence: mapCategoryConfidence(pfc?.confidenceLevel ?? null),
    pfc_primary: pfc?.primary ?? null,
    pfc_detailed: pfc?.detailed ?? null,
    category_taxonomy_version: txn.taxonomyVersion,
  };
}

/** True when a provider `modified` event changed a value that affects money math (spec §5: unpair + treat as substantive). */
export function substantiveChange(a: ProviderColumns, b: ProviderColumns): boolean {
  return a.posted_date !== b.posted_date || a.amount !== b.amount || a.direction !== b.direction;
}
