// src/lib/concepts/content/free-cash-flow.ts
import type { FinancialConcept } from "../types";

export const freeCashFlow: FinancialConcept = {
  id: "free-cash-flow",
  title: "Free cash flow",
  shortDefinition: "The money remaining after the expenses required to operate your household have been paid.",
  fullDefinition:
    "Free cash flow is what's left of your household's revenue after operating expenses are paid. It is the cash your household is free to allocate — to savings, investments, or paying down debt. A household can own valuable things and still have weak free cash flow, or own little and generate strong free cash flow.",
  whyItMatters:
    "Free cash flow is the engine of financial progress. Every dollar of savings, investing, and debt paydown comes out of it. Investors watch a company's free cash flow because it shows what the business really generates after keeping the lights on — the same question applies to a household.",
  formula: "Revenue − operating expenses",
  householdAdaptation:
    "In corporate accounting, free cash flow is operating cash flow minus capital expenditures. PFI's household version is simpler: revenue minus operating expenses. The idea is the same — cash generated after the cost of operating — without corporate adjustments that don't apply to households.",
  businessContext:
    "Public companies report free cash flow to show how much cash the business generates beyond what it must spend to operate. It funds dividends, buybacks, debt paydown, and growth — a company's version of your allocation choices.",
  commonMisunderstanding:
    "Free cash flow is not the balance in your checking account. A balance is what you hold right now; free cash flow is what a period of operating produced. You can hold a large balance while your free cash flow is negative — spending down what you saved earlier.",
  relatedConceptIds: ["cash-flow", "savings-rate", "retained-cash", "capital-allocation"],
  prerequisiteConceptIds: ["revenue", "operating-expenses"],
  dataMetricKey: "report:freeCashFlow",
  status: "published",
  lesson: {
    intro:
      "Think of your household as a small company. Money comes in; running the household costs money; whatever is left over is yours to direct. That leftover amount has a name professionals use constantly: free cash flow.",
    standardTerm:
      "“Free cash flow” (often abbreviated FCF) is one of the most-watched numbers in business and investing. When analysts ask whether a company “generates cash,” this is the number they mean.",
    calculation: {
      formula: "Revenue − operating expenses = free cash flow",
      walkthrough:
        "Add up everything your household earned in the period (revenue). Subtract what it cost to operate — housing, food, utilities, transport, and other operating expenses. Transfers between your own accounts don't count as either. What remains is free cash flow.",
    },
    genericExample:
      "Sample figures: the Rivera household earns $6,200 of revenue in a month and pays $4,750 of operating expenses. Their free cash flow is $6,200 − $4,750 = $1,450. That $1,450 is what they can direct toward savings, investments, or extra debt payments.",
    personalApplication: {
      metricKey: "report:freeCashFlow",
      interpretationRules:
        "Positive: the household generated cash this period; describe the amount as available for allocation. Negative: operating costs exceeded revenue this period; state it plainly without alarm and note which side (revenue or expenses) moved. Zero or near zero: the household roughly broke even. Unavailable: say which data is missing (income or spending transactions); never estimate.",
      requiresData: ["income-transactions", "spending-transactions"],
    },
    commonMisunderstanding:
      "Free cash flow is not the same as the balance in your checking account, and it is not the same as your savings rate. The balance is a snapshot of what you hold; free cash flow measures what one period of operating produced; the savings rate measures how much of revenue you kept as cash.",
    knowledgeCheck: [
      {
        kind: "identify-figure",
        prompt: "Sample figures: a household earns $5,000 in a month and its operating expenses are $4,200. What is its free cash flow?",
        choices: ["$800", "$5,000", "$4,200", "Whatever is in its checking account"],
        correctIndex: 0,
        explanation: "Free cash flow = revenue − operating expenses = $5,000 − $4,200 = $800. The checking balance is a snapshot, not a flow.",
      },
      {
        kind: "which-action",
        prompt: "Which action would increase a household's free cash flow next month?",
        choices: [
          "Reducing a recurring operating expense",
          "Moving money from savings to checking",
          "Checking the account balance more often",
          "Renaming a spending category",
        ],
        correctIndex: 0,
        explanation:
          "Free cash flow only moves when revenue or operating expenses move. Transfers between your own accounts and relabeling don't change it.",
      },
    ],
    reinforcementPreview:
      "Free cash flow appears throughout PFI: the report's statement and management commentary, the Free cash flow margin metric inside your PFI Score's Cash Flow dimension, and drivers on your dashboard's “What moved your line.”",
  },
};
