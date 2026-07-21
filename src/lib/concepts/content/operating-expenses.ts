// src/lib/concepts/content/operating-expenses.ts
import type { FinancialConcept } from "../types";

export const operatingExpenses: FinancialConcept = {
  id: "operating-expenses",
  title: "Operating expenses",
  classification: "standard_finance" as const,
  shortDefinition: "The recurring cost of running your household — housing, food, utilities, transport, and similar spending.",
  fullDefinition:
    "Operating expenses are what it costs to run your household day to day: housing, food, utilities, transport, and comparable recurring spending. They are measured against revenue to see how much of what came in was consumed by the cost of operating. Money moved into savings or investments is not an operating expense — it's a choice about what to do with what's left.",
  whyItMatters:
    "Operating expenses are the other half of the free cash flow equation. A household's financial position can weaken even when revenue holds steady, if operating expenses quietly grow. Tracking this number is how a household understands the cost of its own operation, separate from what it chooses to save or invest.",
  formula: "Sum of household spending in the period (transfers, savings, and investment contributions excluded)",
  householdAdaptation:
    "Corporate operating expenses exclude the cost of goods sold and capital purchases — categories that don't map onto a household. PFI's version is simply all operating spending: the cost of keeping the household running. Money moved to savings or investments is not counted here — it's an allocation of free cash flow, not a cost of operating.",
  businessContext:
    "Investors track a company's operating expenses against its revenue to judge discipline — a pattern often called “operating leverage,” where revenue growing faster than expenses signals a business getting more efficient over time.",
  commonMisunderstanding:
    "Putting money into savings or an investment account is not an operating expense. It's an allocation of free cash flow — a choice about where to direct money that's already been earned and kept, not a cost of running the household.",
  relatedConceptIds: ["revenue", "free-cash-flow"],
  prerequisiteConceptIds: ["revenue"],
  dataMetricKey: "report:operatingExpenses",
  status: "published",
  lesson: {
    intro:
      "Running a household costs money — rent or a mortgage, groceries, utilities, getting to work. Businesses have a name for this kind of recurring cost, and it applies just as directly to a household: operating expenses.",
    standardTerm:
      "“Operating expenses” (often shortened to OpEx) is the standard term for the recurring costs of running an operation, as opposed to one-time or capital costs. Analysts watch this line closely because it shows how much revenue gets consumed just keeping things running.",
    calculation: {
      formula: "Housing + food + utilities + transport + other recurring spending = operating expenses",
      walkthrough:
        "Add up everything the household spent on operating the household during the period. Leave out transfers between accounts and money moved to savings or investments — those aren't the cost of operating, they're what happens to money after it's been kept.",
    },
    genericExample:
      "Sample figures: the Rivera household's operating expenses for the month total $4,750 — rent, groceries, utilities, and transport. That's the cost of running their household this period, separate from anything they saved or invested.",
    personalApplication: {
      metricKey: "report:operatingExpenses",
      interpretationRules:
        "Report the period total and its direction compared with the prior period. State rising expenses factually — as a change to note and, where useful, to look into — never as blame or a verdict on the household. Unavailable: name the missing data (spending transactions); never estimate.",
      requiresData: ["spending-transactions"],
    },
    commonMisunderstanding:
      "A 401(k) contribution or a transfer to a savings account is not an operating expense, even though it leaves the checking account. Operating expenses are the cost of running the household; savings and investment contributions are what the household chooses to do with money it already kept.",
    knowledgeCheck: [
      {
        kind: "identify-figure",
        prompt: "Which of these counts as an operating expense?",
        choices: [
          "Rent paid for the month",
          "A 401(k) contribution",
          "A transfer to a savings account",
          "An extra payment toward mortgage principal",
        ],
        correctIndex: 0,
        explanation:
          "Rent is the cost of operating the household. The other three move money the household already earned into savings, retirement, or debt paydown — allocations, not operating costs.",
      },
      {
        kind: "interpretation",
        prompt: "A household's operating expenses rose two months in a row while revenue stayed flat. What does this mean for free cash flow?",
        choices: [
          "Free cash flow shrank, since it's revenue minus operating expenses",
          "Free cash flow must have grown",
          "Free cash flow is unaffected by operating expenses",
          "There's not enough information to say anything",
        ],
        correctIndex: 0,
        explanation:
          "Free cash flow is revenue minus operating expenses. With revenue flat and operating expenses rising, free cash flow necessarily shrank.",
      },
    ],
    reinforcementPreview:
      "Operating expenses appear in your report's statement and management commentary, feed directly into free cash flow, and show up as drivers on your dashboard's “What moved your line.”",
  },
};
