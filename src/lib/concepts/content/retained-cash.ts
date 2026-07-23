// src/lib/concepts/content/retained-cash.ts
import type { FinancialConcept } from "../types";

export const retainedCash: FinancialConcept = {
  id: "retained-cash",
  title: "Retained cash",
  classification: "household_adaptation" as const,
  shortDefinition: "The portion of free cash flow your household kept as cash rather than allocating elsewhere.",
  plainEnglishSummary:
    "The slice of your free cash flow that stayed as cash — not moved into investments and not used to pay down debt beyond the minimum. It's the numerator of your savings rate.",
  fullDefinition:
    "Retained cash is the slice of a household's free cash flow that stayed as cash — not sent to an investment account and not used to pay down debt beyond the required minimum. It's the numerator in the savings rate: retained cash divided by revenue produces the savings-rate percentage.",
  whyItMatters:
    "Free cash flow can be directed in more than one way, and retained cash isolates just the cash-building piece of that decision. Understanding it separately from free cash flow itself avoids assuming that all money left over after expenses simply piles up as cash — often it doesn't, by design.",
  formula: "Free cash flow − investment contributions − debt reduction = retained cash",
  formulaRows: [
    { label: "Free cash flow" },
    { label: "Investment contributions", operator: "-" },
    { label: "Debt reduction", operator: "-" },
    { label: "Retained cash", operator: "=" },
  ],
  businessContext:
    "The corporate cousin of this idea is “retained earnings” — the portion of a company's profit that management chooses to keep rather than pay out or reinvest elsewhere. A household's retained cash is the same choice applied at household scale.",
  whereUsed: ["Report (Savings line, under “Allocated to”)", "Savings rate"],
  relatedConceptIds: ["free-cash-flow", "savings-rate", "capital-allocation"],
  prerequisiteConceptIds: [],
  dataMetricKey: "report:savings",
  status: "published",
};
