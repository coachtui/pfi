/** Product-level transaction taxonomy. The engine only interprets "income"
 * (obligation windows); everything else is display/report grouping. */
export const CATEGORIES = [
  "income", "housing", "utilities", "insurance", "groceries", "dining",
  "transport", "health", "shopping", "discretionary", "debt_payment",
  "savings", "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  income: "Income", housing: "Housing", utilities: "Utilities",
  insurance: "Insurance", groceries: "Groceries", dining: "Dining",
  transport: "Transport", health: "Health", shopping: "Shopping",
  discretionary: "Discretionary", debt_payment: "Debt payment",
  savings: "Savings", other: "Other",
};
