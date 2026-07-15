/** Broad bands only — exact ages/incomes are never collected (privacy by construction). */
export const AGE_COHORTS = ["18–29", "30–39", "40–49", "50–59", "60+"] as const;
export const INCOME_BANDS = ["<$50k", "$50k–$100k", "$100k–$150k", "$150k–$200k", "$200k+"] as const;
export const HOUSEHOLD_TYPES = ["Single", "Couple", "Family with children", "Multi-generational", "Other"] as const;
export const COL_CATEGORIES = ["Low-Cost Region", "Mid-Cost Region", "High-Cost Region"] as const;
export const OBJECTIVES = [
  { value: "increase_liquidity", label: "Build cash cushion" },
  { value: "reduce_debt", label: "Pay down debt" },
  { value: "build_emergency_fund", label: "Build emergency fund" },
  { value: "grow_investments", label: "Grow investments" },
  { value: "buy_home", label: "Save for a home" },
  { value: "financial_independence", label: "Financial independence" },
] as const;
