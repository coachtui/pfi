// src/lib/concepts/content/cash-flow.ts
import type { FinancialConcept } from "../types";

export const cashFlow: FinancialConcept = {
  id: "cash-flow",
  title: "Cash flow",
  classification: "standard_finance" as const,
  shortDefinition: "The movement of money into and out of your household over a period of time.",
  fullDefinition:
    "Cash flow describes how money moves through your household over time — what came in, what went out, and the net direction. Unlike a balance, which is a single number at a single moment, cash flow is measured over a period and shows the pattern of movement, not just where things stand right now.",
  whyItMatters:
    "Cash flow is what turns a snapshot into a story. A balance tells you where things stand today; cash flow tells you whether the household is generally moving forward, backward, or holding steady. Most of the concepts in this module — revenue, operating expenses, free cash flow — are ways of measuring specific parts of cash flow.",
  formula: "Money in − money out, over a period",
  businessContext:
    "Public companies publish an entire cash-flow statement alongside their income statement and balance sheet, because a business can look profitable on paper while running out of cash. The phrase “cash is king” refers to exactly this — cash flow, not just reported profit, is what keeps an operation running.",
  commonMisunderstanding:
    "Cash flow is a movie, not a photograph. A large account balance is a photograph — a snapshot of where things stand right now. It can look reassuring while hiding negative cash flow — a household or business that's steadily spending down money it saved earlier.",
  relatedConceptIds: ["revenue", "operating-expenses", "free-cash-flow"],
  prerequisiteConceptIds: ["revenue", "operating-expenses"],
  dataMetricKey: "metric:recurring_surplus",
  status: "published",
  lesson: {
    opening:
      "Your account balance tells you what you have right now. It doesn't tell you whether you're generally taking in more than you spend, or the reverse. That pattern over time has a name: cash flow.",
    standardTerm:
      "“Cash flow” is the standard term for the movement of money into and out of an operation over a period, as distinct from a balance at a single point in time. It's central enough to business and investing that companies publish a dedicated cash-flow statement.",
    calculation: {
      formula: "Money in − money out, over a period = net cash flow",
      walkthrough:
        "Look at everything that came into the household over a period and everything that went out. The difference is the net cash flow for that period — positive if more came in than went out, negative if the reverse.",
    },
    genericExample:
      "Sample figures: over a typical month, the Rivera household takes in $6,200 and pays out $4,750 in operating expenses. Their net cash flow for that month is positive — more came in than went out.",
    personalApplication: {
      metricKey: "metric:recurring_surplus",
      interpretationRules:
        "Describe the household's typical monthly net flow and, most importantly, its steadiness across recent periods — whether the pattern holds from month to month, rather than fixating on any single period's raw amount. Unavailable: name the missing data (income or spending transactions); never estimate.",
      requiresData: ["income-transactions", "spending-transactions"],
    },
    commonMisunderstanding:
      "A healthy-looking account balance does not guarantee positive cash flow. A household can hold a large balance built up in the past while its current cash flow is negative — spending down that balance a little more each month.",
    knowledgeChecks: [
      {
        id: "cash-flow-check-1",
        kind: "interpretation",
        prompt: "A household's account balance is high, but its cash flow this month is negative. What does this most likely mean?",
        choices: [
          "The household is spending down savings built up in earlier periods",
          "The balance figure must be incorrect",
          "Cash flow doesn't matter if the balance is high",
          "The household has no operating expenses",
        ],
        correctIndex: 0,
        explanation:
          "A high balance is a snapshot from the past; negative cash flow means more went out than came in this period. Together, they describe a household drawing down money it saved earlier.",
      },
    ],
    reinforcementPreview:
      "Cash flow underlies your report's statement, the Typical monthly free cash flow metric inside your Fundamentals Score's Cash Flow dimension, and the overall shape of your dashboard's indexed performance chart.",
  },
};
