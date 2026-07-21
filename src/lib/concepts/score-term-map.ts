// src/lib/concepts/score-term-map.ts
// Framework-free. Maps a score-dimension metric id → the concept whose
// definition that metric's *label* teaches (what word the user is reading).
// This is deliberately distinct from a concept's dataMetricKey (which engine
// field feeds a lesson's personalization) — a label→term binding, not a
// data binding. Validated in score-term-map.test.ts.
import type { ConceptId } from "./types";

export const SCORE_METRIC_CONCEPT_IDS: Record<string, ConceptId> = {
  net_cash_flow_margin: "free-cash-flow", // "Free cash flow margin"
  recurring_surplus: "free-cash-flow",    // "Typical monthly free cash flow"
  liquid_runway_months: "liquidity",      // "Emergency runway"
  debt_service_ratio: "debt-pressure",    // "Debt burden"
};
