// src/lib/concepts/content/revenue.ts
import type { FinancialConcept } from "../types";

export const revenue: FinancialConcept = {
  id: "revenue",
  title: "Revenue",
  classification: "standard_finance",
  shortDefinition:
    "All the money your household brings in — pay, side income, benefits, and other earnings.",
  plainEnglishSummary:
    "New money your household earned or received from outside sources during a period — paychecks, side income, and benefits.",
  memorableDistinction: "Not every deposit is revenue.",
  fullDefinition:
    "Revenue is the total of every dollar your household received in a period, from every source. It includes wages, side income, and benefits. It does not include money that simply moved between your own accounts — a transfer from savings to checking is not new money, so it is not revenue.",
  whyItMatters:
    "Revenue is the starting point for everything else in your household's finances. Operating expenses are paid out of it, free cash flow is measured against it, and your savings rate is a share of it. Nothing downstream can be understood without first knowing what came in.",
  formula: "Paychecks + side income + benefits + other external earnings = revenue",
  formulaRows: [
    { label: "Paychecks", staticValue: "$5,800" },
    { label: "Side income", operator: "+", staticValue: "$250" },
    { label: "Benefits", operator: "+", staticValue: "$150" },
    { label: "Revenue", operator: "=", staticValue: "$6,200" },
  ],
  comparisonRows: [
    { label: "Paycheck", included: true, explanation: "New money earned from outside the household." },
    { label: "Side-income payment", included: true, explanation: "New externally earned income." },
    { label: "Transfer from savings", included: false, explanation: "The household already owned it." },
    { label: "Loan proceeds", included: false, explanation: "Borrowed money creates a liability, not income." },
    { label: "Purchase refund", included: false, explanation: "It reverses prior spending rather than creating income." },
  ],
  interpretation:
    "Rising revenue is not the same as being better off. Revenue can rise while free cash flow falls if operating expenses rise faster — and steady revenue with falling expenses can strengthen a household more than a raise. Read revenue together with operating expenses and free cash flow, not on its own.",
  householdAdaptation:
    "Corporate revenue means sales of goods or services. A household doesn't sell anything in that sense, so PFI's version counts every source of income instead — wages, side income, and benefits. Refunds are treated as reducing spending rather than as revenue, since they reverse a purchase rather than create new income.",
  businessContext:
    "Analysts call revenue “the top line” because it sits at the top of a company's income statement. Growth is judged against it — a company is described as growing or shrinking based on whether revenue is rising or falling period over period.",
  commonMisunderstanding:
    "Revenue is not what you keep — that's free cash flow. A raise increases revenue, but if operating expenses rise just as fast, the household is no better off in cash terms even though revenue went up.",
  whereUsed: [
    "Household statement (Report)",
    "Management commentary",
    "Free cash flow calculation",
    "Savings-rate calculation",
    "“What moved your line” on the dashboard",
  ],
  relatedConceptIds: ["operating-expenses", "cash-flow"],
  prerequisiteConceptIds: [],
  dataMetricKey: "report:revenue",
  status: "published",
  lesson: {
    opening:
      "Every household has money entering from outside — paychecks, side work, benefits, other earnings. Before PFI can measure spending, cash flow, or savings efficiency, that incoming money needs a name. In business and investing, it is called revenue.",
    standardTerm:
      "“Revenue” is the standard term for money a business (or, here, a household) brings in during a period. It's also called “the top line” because of where it appears on a company's income statement.",
    calculation: {
      walkthrough:
        "Add up every dollar that came into the household in the period from an outside source: paychecks, side income, benefits, and similar earnings. Leave out anything that was already the household's money — like a transfer from savings into checking — and anything that reverses spending or creates a debt, like a refund or a loan disbursement.",
    },
    genericExample:
      "Sample figures: the Rivera household's revenue for the month is $6,200 — $5,800 in paychecks, $250 of side income, and $150 in benefits. That $6,200 is the number everything else in this module is measured against.",
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
    completionSummary:
      "You can now recognize revenue throughout PFI and understand how it drives free cash flow, savings rate, and your household's performance measurements.",
  },
};
