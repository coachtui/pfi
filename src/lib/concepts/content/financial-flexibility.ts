// src/lib/concepts/content/financial-flexibility.ts
import type { FinancialConcept } from "../types";

export const financialFlexibility: FinancialConcept = {
  id: "financial-flexibility",
  title: "Financial flexibility",
  shortDefinition: "Your household's room to absorb surprises or seize opportunities without borrowing.",
  fullDefinition:
    "Financial flexibility is the room a household has to handle the unexpected — a repair, a medical bill, a slow month — or to act on an opportunity, without having to take on new debt. It draws on several things at once: how liquid a household's assets are, how much of its income is already committed to short-term obligations, and how much pressure existing debt already creates.",
  whyItMatters:
    "Two households with identical net worth can have very different flexibility. One with cash on hand and light debt payments can weather a surprise easily; one with the same net worth locked into illiquid assets and heavy required payments has far less room to maneuver.",
  businessContext:
    "This is why companies hold cash reserves and maintain credit lines even when profitable — flexibility protects against the unexpected in a way that raw profitability alone doesn't. A profitable company with no cash cushion can still be caught short by a single bad quarter.",
  relatedConceptIds: ["liquidity", "free-cash-flow", "available-capital"],
  prerequisiteConceptIds: [],
  dataMetricKey: "position:cushion",
  status: "published",
};
