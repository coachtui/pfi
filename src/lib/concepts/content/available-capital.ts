// src/lib/concepts/content/available-capital.ts
import type { FinancialConcept } from "../types";

export const availableCapital: FinancialConcept = {
  id: "available-capital",
  title: "Available capital",
  classification: "pfi_metric",
  shortDefinition:
    "Cash you can actually deploy: liquid assets minus revolving balances and obligations due before your next income.",
  plainEnglishSummary:
    "The money your household can safely put to work today, after subtracting revolving debt and obligations due before the next expected income.",
  memorableDistinction: "Cash that exists is not always cash that is free to use.",
  fullDefinition:
    "Available capital is the cash a household can actually deploy right now — liquid assets minus revolving balances and minus obligations due before the next expected income. It answers a more precise question than liquidity alone: not just how much cash exists, but how much of it is genuinely free to use after what's already committed against it.",
  whyItMatters:
    "Cash balances can overstate financial flexibility. A household can hold a sizable liquid balance and still have little room to act if much of it is offset by a revolving balance or an obligation coming due. Available capital separates money that exists from money that is genuinely free to use.",
  formula: "Liquid assets − revolving balances − near-term obligations = available capital",
  formulaRows: [
    { label: "Liquid assets" },
    { label: "Revolving balances", operator: "-" },
    { label: "Near-term obligations", operator: "-" },
    { label: "Available capital", operator: "=" },
  ],
  interpretation:
    "Available capital can fall while net worth rises — for example, when gains land in illiquid assets while near-term obligations grow. Read it as immediate flexibility, not overall wealth.",
  householdAdaptation:
    "Available capital is PFI's household measure of available financial position — the quantity your Personal Index, personal baseline, and financial waterline are computed from. It has no single direct corporate-accounting equivalent, so PFI keeps a distinct name for it.",
  businessContext:
    "Its closest business cousins are working capital and what investors sometimes call \"dry powder\" — cash a business or investor has on hand and free to deploy, net of near-term claims against it.",
  whereUsed: [
    "Home dashboard (Available capital card)",
    "Personal Index",
    "Personal baseline",
    "Financial waterline",
  ],
  relatedConceptIds: ["liquidity", "short-term-obligations", "financial-flexibility"],
  prerequisiteConceptIds: [],
  dataMetricKey: "position:availablePosition",
  status: "published",
};
