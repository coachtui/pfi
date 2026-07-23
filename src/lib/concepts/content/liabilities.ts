// src/lib/concepts/content/liabilities.ts
import type { FinancialConcept } from "../types";

export const liabilities: FinancialConcept = {
  id: "liabilities",
  title: "Liabilities",
  classification: "standard_finance" as const,
  shortDefinition: "Everything your household owes to someone else.",
  plainEnglishSummary:
    "Everything the household owes: a mortgage, loans, and revolving credit-card balances.",
  memorableDistinction: "A liability is what you owe — not this month's expense.",
  fullDefinition:
    "A liability is anything your household owes to someone else — a mortgage balance, a car loan, a student loan, or a credit-card balance. Liabilities are the counterpart to assets: assets are what a household owns, liabilities are what it owes, and the difference between the two is net worth.",
  whyItMatters:
    "Liabilities are the other half of the balance-sheet picture. A household's financial position isn't just about what it owns — it's about what it owns net of what it owes. Two households can own the same assets and be in very different positions depending on how much they owe against them.",
  formula: "Liabilities = mortgage balance + loan balances + credit-card balances + other amounts owed",
  formulaRows: [
    { label: "Mortgage balance", staticValue: "$195,000" },
    { label: "Car loan", operator: "+", staticValue: "$12,000" },
    { label: "Student loan", operator: "+", staticValue: "$3,200" },
    { label: "Credit-card balance", operator: "+", staticValue: "$1,800" },
    { label: "Total liabilities", operator: "=", staticValue: "$212,000" },
  ],
  comparisonRows: [
    {
      label: "Outstanding mortgage balance",
      included: true,
      explanation: "The remaining amount still owed on the home loan, tracked separately from the home's own value as an asset.",
    },
    {
      label: "Auto-loan and student-loan balances",
      included: true,
      explanation: "The full remaining balance still owed on each loan, regardless of the size of the monthly installment.",
    },
    {
      label: "Revolving credit-card balance",
      included: true,
      explanation: "Whatever is currently owed on the card, not the credit limit and not the minimum payment due.",
    },
    {
      label: "This month's grocery spending",
      included: false,
      explanation: "A completed purchase already paid for in the period — it belongs in operating expenses, not as a debt still owed.",
    },
    {
      label: "A utility bill already paid",
      included: false,
      explanation: "Settled in full, so nothing remains outstanding — a paid bill never becomes a liability.",
    },
  ],
  interpretation:
    "A larger liability total is not automatically a worse position — what a liability is backed by, and at what cost, matters as much as its size. A mortgage is backed by a specific asset, the home itself, and typically carries a lower interest rate; a revolving credit-card balance is unsecured and typically carries a much higher rate, which makes it a different kind of obligation to carry even at a smaller dollar amount. What matters most for a household's financial position is this total measured against assets — covered next in this module as net worth — and how much of the household's monthly income the required payments consume, covered later as debt pressure. Read liabilities alongside those two, not as a number to judge on its own.",
  businessContext:
    "Liabilities are the right side of a company's balance sheet. Analysts compare a company's liabilities against its assets and against how much cash it generates, because a company (or household) can hold valuable assets and still be under financial strain if its liabilities are large relative to them.",
  commonMisunderstanding:
    "A monthly payment is not the liability — it's what services the liability. If a household makes a $280 monthly payment on a loan, the liability isn't $280; it's the full remaining balance owed, which might be $12,000 or more. The payment reduces the liability over time, but the liability is the whole balance, not the installment.",
  whereUsed: ["Household balance sheet (Report)", "Net worth calculation", "Debt-pressure assessment"],
  relatedConceptIds: ["assets", "net-worth", "debt-pressure"],
  prerequisiteConceptIds: ["assets"],
  status: "published",
  lesson: {
    opening:
      "Now flip the question from the last lesson: instead of what your household owns, what does it owe? A mortgage, a car loan, a credit-card balance — anything your household is obligated to pay back to someone else is a liability.",
    standardTerm:
      "“Liabilities” is the standard business and accounting term for amounts owed to others. Every balance sheet pairs assets with liabilities, because what an entity owns only tells half the story without knowing what's owed against it.",
    calculation: {
      walkthrough:
        "List every debt your household owes: the remaining balance on a mortgage, any car or student loans, and any credit-card or other revolving balances. Use the full remaining balance owed for each, not the monthly payment. Add them together and you have total liabilities.",
    },
    genericExample:
      "Sample figures: the Rivera household has a $195,000 mortgage balance, a $12,000 car loan, a $3,200 student loan, and a $1,800 revolving credit-card balance. Added together, their total liabilities come to $212,000 in this sample scenario — the figure this module's net worth lesson subtracts from their assets.",
    commonMisunderstanding:
      "A monthly payment is not the liability — the payment services the liability. The Rivera household's $12,000 car loan might carry a $280 monthly payment, but the liability on their balance sheet is the full $12,000 remaining balance, not the $280 installment. Confusing the two understates how much is actually owed.",
    knowledgeChecks: [
      {
        id: "liabilities-check-1",
        kind: "identify-figure",
        prompt: "Sample figures: a household has a $12,000 loan balance and makes a $280 monthly payment toward it. What is the liability?",
        choices: ["$12,000", "$280", "$12,280", "$0, since it's being paid down"],
        correctIndex: 0,
        explanation:
          "The liability is the full remaining balance owed — $12,000. The $280 payment is what services the liability each month; it isn't the liability itself.",
      },
    ],
    completionSummary:
      "You can now tell what a household owes — its liabilities — apart from what it spends day to day, and see how liabilities offset assets to produce net worth.",
  },
};
