/**
 * Plaid personal_finance_category → PFI Category (spec §8). Deterministic,
 * pure, taxonomy-version-aware: PFCv2 (Items on the post-December-2025
 * taxonomy, which PFI requests explicitly) is a superset of PFCv1; both
 * published CSVs live in ./fixtures and the test asserts every detailed value
 * in each version resolves through a detailed or primary rule, never the
 * unknown fallback.
 *
 * Rules are consumer-facing groupings only. The engine interprets `income`
 * (obligation windows) and the essential set (docs/FINANCIAL_HEALTH_SCORE.md);
 * everything else is display/report grouping, and a user_override always
 * wins at read time. AI never participates here.
 */
import type { Category } from "@/lib/config/categories";
import type { PfcVersion } from "./types";

export type CategoryMatch = "detailed" | "primary" | "unknown";

export interface CategoryMapping {
  category: Category;
  matched: CategoryMatch;
}

/** Detailed-level rules: applied first, in both versions. */
const DETAILED: Record<string, Category> = {
  FOOD_AND_DRINK_GROCERIES: "groceries",
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: "housing",
  RENT_AND_UTILITIES_RENT: "housing",
  GENERAL_SERVICES_INSURANCE: "insurance",
  GENERAL_SERVICES_AUTOMOTIVE: "transport",
  // Money leaving to an unlinked savings/investment destination. When the
  // destination IS linked, pairing marks both rows as a transfer instead.
  TRANSFER_OUT_SAVINGS: "savings",
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: "savings",
};

/** Primary-level rules, shared by v1 and v2. Anything not listed → other. */
const PRIMARY: Record<string, Category> = {
  INCOME: "income",
  LOAN_PAYMENTS: "debt_payment",
  RENT_AND_UTILITIES: "utilities",
  FOOD_AND_DRINK: "dining",
  TRANSPORTATION: "transport",
  MEDICAL: "health",
  GENERAL_MERCHANDISE: "shopping",
  HOME_IMPROVEMENT: "housing",
  ENTERTAINMENT: "discretionary",
  TRAVEL: "discretionary",
  PERSONAL_CARE: "discretionary",
  // Explicit "other" primaries — listed so the mapper distinguishes a known
  // primary (matched: 'primary') from an unrecognized one (matched: 'unknown').
  BANK_FEES: "other",
  GOVERNMENT_AND_NON_PROFIT: "other",
  GENERAL_SERVICES: "other",
  TRANSFER_IN: "other",
  TRANSFER_OUT: "other",
};

/** v2-only primaries. LOAN_DISBURSEMENTS are loan proceeds — never income. */
const PRIMARY_V2: Record<string, Category> = {
  LOAN_DISBURSEMENTS: "other",
  OTHER: "other",
};

export function mapCategoryDetailed(version: PfcVersion, primary: string | null, detailed: string | null): CategoryMapping {
  const p = (primary ?? "").toUpperCase();
  const d = (detailed ?? "").toUpperCase();
  if (d && DETAILED[d]) return { category: DETAILED[d], matched: "detailed" };
  if (p && PRIMARY[p]) return { category: PRIMARY[p], matched: "primary" };
  if (version === "v2" && p && PRIMARY_V2[p]) return { category: PRIMARY_V2[p], matched: "primary" };
  return { category: "other", matched: "unknown" };
}

/** Convenience: the category alone. */
export function mapCategory(version: PfcVersion, primary: string | null, detailed: string | null): Category {
  return mapCategoryDetailed(version, primary, detailed).category;
}
