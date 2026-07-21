// src/lib/concepts/content/capital-allocation.ts
import type { FinancialConcept } from "../types";

export const capitalAllocation: FinancialConcept = {
  id: "capital-allocation",
  title: "Capital allocation",
  classification: "standard_finance" as const,
  shortDefinition: "Deciding where your free cash flow goes — cash savings, investments, or debt paydown.",
  fullDefinition:
    "Capital allocation is the decision a household makes about where to direct its free cash flow: keeping it as cash, investing it, or using it to pay down debt beyond the required minimum. The same dollar of free cash flow can only go to one of these at a time, which makes allocation a genuine choice with tradeoffs rather than a single automatic outcome.",
  whyItMatters:
    "Two households can generate identical free cash flow and end up in very different positions depending on how they allocate it. Neither more retained cash nor more investment nor more debt paydown is automatically the “right” choice — the right allocation depends on a household's own flexibility, obligations, and goals.",
  businessContext:
    "Many investors consider capital allocation the most important job of a company's CEO — deciding whether profit goes to dividends, buybacks, debt reduction, or reinvestment. Households make an equivalent decision every month, just at a different scale.",
  relatedConceptIds: ["free-cash-flow", "retained-cash", "savings-rate"],
  prerequisiteConceptIds: [],
  status: "published",
};
