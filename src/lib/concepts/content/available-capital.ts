// src/lib/concepts/content/available-capital.ts
import type { FinancialConcept } from "../types";

export const availableCapital: FinancialConcept = {
  id: "available-capital",
  title: "Available capital",
  classification: "pfi_metric" as const,
  shortDefinition: "Cash you can actually deploy: liquid assets minus revolving balances and obligations due before your next income.",
  fullDefinition:
    "Available capital is the cash a household can actually deploy right now — liquid assets minus revolving balances and minus obligations due before the next expected income. It answers a more precise question than liquidity alone: not just how much cash exists, but how much of it is genuinely free to use after what's already committed against it.",
  whyItMatters:
    "A household can hold a sizable liquid balance and still have very little available capital, if much of that balance is offset by a revolving balance or an obligation coming due. Available capital strips out what's already spoken for, leaving the number that reflects real room to act.",
  formula: "Liquid assets − revolving balances − near-term obligations",
  householdAdaptation:
    "Available capital is PFI's signature derived quantity — the “available financial position” that the personal index, personal baseline, and financial waterline are all computed from. It has no single corporate equivalent, which is why it keeps its own name rather than borrowing a business term (audit ruling, spec findings #6).",
  businessContext:
    "Its closest business cousins are working capital and what investors sometimes call “dry powder” — cash a business or investor has on hand and free to deploy, net of near-term claims against it.",
  relatedConceptIds: ["liquidity", "short-term-obligations", "financial-flexibility"],
  prerequisiteConceptIds: [],
  dataMetricKey: "position:availablePosition",
  status: "published",
};
