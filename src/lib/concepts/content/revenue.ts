// src/lib/concepts/content/revenue.ts
import type { FinancialConcept } from "../types";

export const revenue: FinancialConcept = {
  id: "revenue",
  title: "Revenue",
  classification: "standard_finance" as const,
  shortDefinition: "All the money your household brings in — pay, side income, benefits, and other earnings.",
  fullDefinition:
    "Revenue is the total of every dollar your household received in a period, from every source. It includes wages, side income, and benefits. It does not include money that simply moved between your own accounts — a transfer from savings to checking is not new money, so it is not revenue.",
  whyItMatters:
    "Revenue is the starting point for everything else in your household's finances. Operating expenses are paid out of it, free cash flow is measured against it, and your savings rate is a share of it. Nothing downstream can be understood without first knowing what came in.",
  formula: "Sum of all money earned in the period (transfers between your own accounts excluded)",
  householdAdaptation:
    "Corporate revenue means sales of goods or services. A household doesn't sell anything in that sense, so PFI's version counts every source of income instead — wages, side income, and benefits. Refunds are treated as reducing spending rather than as revenue, since they reverse a purchase rather than create new income.",
  businessContext:
    "Analysts call revenue “the top line” because it sits at the top of a company's income statement. Growth is judged against it — a company is described as growing or shrinking based on whether revenue is rising or falling period over period.",
  commonMisunderstanding:
    "Revenue is not what you keep — that's free cash flow. A raise increases revenue, but if operating expenses rise just as fast, the household is no better off in cash terms even though revenue went up.",
  relatedConceptIds: ["operating-expenses", "cash-flow"],
  prerequisiteConceptIds: [],
  dataMetricKey: "report:revenue",
  status: "published",
  lesson: {
    opening:
      "Every household has money coming in from somewhere — a paycheck, side work, benefits. Before anything else can be measured, that incoming money needs a name. In business and investing, it's called revenue.",
    standardTerm:
      "“Revenue” is the standard term for money a business (or, here, a household) brings in during a period. It's also called “the top line” because of where it appears on a company's income statement.",
    calculation: {
      formula: "Wages + side income + benefits + other earnings = revenue",
      walkthrough:
        "Add up every dollar that came into the household in the period from an outside source: paychecks, side income, benefits, and similar earnings. Leave out anything that was already the household's money, like a transfer from savings to checking or a credit-card refund.",
    },
    genericExample:
      "Sample figures: the Rivera household's revenue for the month is $6,200 — made up of paychecks and a small amount of side income. That $6,200 is the number everything else in this module is measured against.",
    personalApplication: {
      metricKey: "report:revenue",
      interpretationRules:
        "Describe the period total plainly and note whether it has been steady or has varied across recent periods. If income is irregular — for example, mixing salary with variable side income — say so neutrally, without treating variability itself as good or bad. Unavailable: name the missing data (income transactions); never estimate.",
      requiresData: ["income-transactions"],
    },
    commonMisunderstanding:
      "Revenue is not the same as free cash flow. Revenue is everything that came in; free cash flow is what's left after operating expenses are paid. A household's revenue can rise while its free cash flow shrinks, if expenses grew even faster.",
    knowledgeChecks: [
      {
        id: "revenue-check-1",
        kind: "identify-figure",
        prompt: "Which of these is revenue?",
        choices: [
          "A paycheck deposited into checking",
          "A transfer from savings into checking",
          "A refund credited after returning an item",
          "A loan disbursement deposited into checking",
        ],
        correctIndex: 0,
        explanation:
          "A paycheck is new money from an outside source, so it's revenue. Transfers move money the household already had; refunds reverse a purchase; a loan disbursement is borrowed money, not earned income.",
      },
      {
        id: "revenue-check-2",
        kind: "interpretation",
        prompt: "A household's revenue rose this month, but its free cash flow fell. What's the most likely explanation?",
        choices: [
          "Operating expenses rose faster than revenue did",
          "The revenue figure must be wrong",
          "The household transferred money to savings",
          "Free cash flow only depends on revenue",
        ],
        correctIndex: 0,
        explanation:
          "Free cash flow is revenue minus operating expenses. If revenue went up but free cash flow went down, expenses must have grown by even more.",
      },
    ],
    reinforcementPreview:
      "Revenue is the top line of your report's statement, the base of your savings rate and Free cash flow margin metrics, and a frequent driver on your dashboard's “What moved your line.”",
  },
};
