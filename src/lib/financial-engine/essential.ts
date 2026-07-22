/**
 * Deterministic category → "essential (must-pay) spend" classification.
 * Feeds totals.essential in metric-inputs, which gates the PFI score
 * (liquid_runway_months) and drives fixed_cost_ratio. Kept in the engine
 * (not config/) so the engine stays self-contained and framework-free.
 * Category taxonomy source of truth: src/lib/config/categories.ts.
 * Normative mapping: docs/FINANCIAL_HEALTH_SCORE.md.
 */
export const ESSENTIAL_CATEGORIES: ReadonlySet<string> = new Set([
  "housing", "utilities", "insurance", "groceries", "health", "debt_payment", "transport",
]);

/**
 * Whether spending in this category is essential by default. Unknown or null
 * categories are non-essential (conservative: unflagged spend never inflates
 * essential costs). An explicit per-transaction `essential` flag overrides
 * this — see metric-inputs.
 */
export function essentialForCategory(category: string | null): boolean {
  return category !== null && ESSENTIAL_CATEGORIES.has(category);
}
