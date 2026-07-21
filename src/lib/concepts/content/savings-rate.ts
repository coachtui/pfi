// src/lib/concepts/content/savings-rate.ts
import type { FinancialConcept } from "../types";

export const savingsRate: FinancialConcept = {
  id: "savings-rate",
  title: "Savings rate",
  shortDefinition: "The share of your revenue you kept as cash this period.",
  fullDefinition:
    "Savings rate is the portion of your household's revenue that stayed as cash during the period, rather than being spent on operating expenses or directed elsewhere. It measures cash retention specifically — it does not include money sent to investments or used to pay down debt, even though those are also productive uses of free cash flow.",
  whyItMatters:
    "Savings rate shows how much of what a household earns actually accumulates as cash on hand, which matters for short-term flexibility and emergency readiness. It's a narrower and more specific number than people often assume, so understanding exactly what it does and doesn't count avoids drawing the wrong conclusion from it.",
  formula: "Retained cash ÷ revenue",
  householdAdaptation:
    "People often use “savings rate” loosely to mean (income − spending) ÷ income. In PFI, that broader idea is a different metric — Free cash flow margin. PFI's savings rate is the canonical, narrower definition: retained cash ÷ revenue. It counts only the share of revenue that stayed as cash; money allocated to investments or debt paydown is tracked separately and doesn't count toward it.",
  businessContext:
    "Savings rate is analogous to a company's decision about how much of its free cash flow to hold as cash versus deploy elsewhere — toward buybacks, debt reduction, or reinvestment. A company retaining cash isn't automatically doing better than one deploying it; the same is true for a household.",
  commonMisunderstanding:
    "A low savings rate is not automatically a problem. A household can have a strong free cash flow margin — earning comfortably more than it spends — while deliberately directing most of that free cash flow into investments or extra debt payments instead of a cash account. That household would show a low savings rate despite being in a strong position.",
  relatedConceptIds: ["free-cash-flow"],
  prerequisiteConceptIds: ["free-cash-flow"],
  dataMetricKey: "report:savingsRatePct",
  status: "published",
  lesson: {
    intro:
      "Once a household knows what it earned and what's left after operating costs, a natural next question is: how much of that stayed as cash? The answer to that specific question is called the savings rate.",
    standardTerm:
      "“Savings rate” is a widely used term, but it's used loosely in everyday conversation. PFI uses a precise, standard definition: the share of revenue retained as cash. It's related to, but distinct from, the broader idea of how much a household kept overall after spending.",
    calculation: {
      formula: "Retained cash ÷ revenue = savings rate",
      walkthrough:
        "Take the amount of free cash flow that ended up staying as cash — not sent to an investment account and not used to pay down debt beyond the minimum. Divide that retained-cash amount by revenue for the same period. The result, as a percentage, is the savings rate.",
    },
    genericExample:
      "Sample figures: the Rivera household has $6,200 of revenue and keeps $620 of it as cash this month, directing the rest of their $1,450 free cash flow toward investments and extra debt payments. Their savings rate is $620 ÷ $6,200 = 10%.",
    personalApplication: {
      metricKey: "report:savingsRatePct",
      interpretationRules:
        "State the percentage and translate it into a dollar amount of retained cash for the period. When the rate is 0% or near it, check whether free cash flow was instead directed to investments or debt paydown before describing the household as having “kept nothing” — if so, describe that allocation instead. Never praise an unusually high savings rate as a sign of admirable austerity, and never frame a low rate as a failure. Unavailable: name the missing data (income or spending transactions); never estimate.",
      requiresData: ["income-transactions", "spending-transactions"],
    },
    commonMisunderstanding:
      "Savings rate is not the same as Free cash flow margin. Free cash flow margin measures how much of revenue was left after operating expenses, full stop. Savings rate measures only the slice of that leftover amount that stayed as cash — money sent to investments or debt paydown counts toward free cash flow margin but not toward savings rate.",
    knowledgeCheck: [
      {
        kind: "interpretation",
        prompt: "A household has a savings rate of 5% but makes large monthly contributions to an investment account. Is this household a weak saver?",
        choices: [
          "Not necessarily — the household may be allocating free cash flow to investments instead of cash",
          "Yes, a 5% savings rate always signals a problem",
          "It's impossible to have a low savings rate and also invest",
          "Savings rate and investment contributions are the same measurement",
        ],
        correctIndex: 0,
        explanation:
          "Savings rate only counts cash that was retained. A household can have strong free cash flow and choose to direct most of it to investments or debt paydown, which lowers the savings rate without indicating weakness.",
      },
      {
        kind: "identify-figure",
        prompt: "Sample figures: a household has $4,000 of revenue and keeps $400 of it as cash this month. What is its savings rate?",
        choices: ["10%", "40%", "4%", "$400"],
        correctIndex: 0,
        explanation: "Savings rate = retained cash ÷ revenue = $400 ÷ $4,000 = 10%.",
      },
    ],
    reinforcementPreview:
      "Savings rate appears in your report's statement, alongside the related Free cash flow margin metric inside your PFI Score's Cash Flow dimension, and in drivers on your dashboard's “What moved your line.”",
  },
};
