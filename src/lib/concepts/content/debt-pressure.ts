// src/lib/concepts/content/debt-pressure.ts
import type { FinancialConcept } from "../types";

export const debtPressure: FinancialConcept = {
  id: "debt-pressure",
  title: "Debt pressure",
  shortDefinition: "How much of your revenue is committed to required debt payments.",
  fullDefinition:
    "Debt pressure measures the share of your household's revenue that must go toward required debt payments — the minimums on loans and credit cards, with housing measured separately. It's a measure of strain, not size: it compares what you owe monthly against what you earn monthly, rather than the total balance owed.",
  whyItMatters:
    "Two households can owe very different total amounts and still face the same pressure, or owe the same amount and face very different pressure, depending on their required payments relative to income. Debt pressure shows how much room a household has to absorb a surprise — a repair, a slow month, a rate change — after required payments are made.",
  formula: "Required debt payments ÷ revenue",
  householdAdaptation:
    "Business analysts call this family of measures “debt service” ratios — comparing required debt payments against income or cash flow. PFI's Debt burden metric applies the same idea to a household: loan and credit-card payments as a share of income, with housing measured separately so it's counted once rather than twice.",
  businessContext:
    "Lenders and analysts read a company's debt service against its income to judge how much strain existing obligations create. A company with heavy required payments has less room to absorb a bad quarter — the same logic applies to a household absorbing a bad month.",
  commonMisunderstanding:
    "Total debt and debt pressure are different measurements. A large mortgage with a low required payment can pressure a budget less than a small credit-card balance with a punishing minimum payment. Looking at the balance owed alone tells you size, not strain — pressure requires comparing the required payment against income.",
  relatedConceptIds: ["liabilities", "short-term-obligations", "financial-flexibility", "free-cash-flow"],
  prerequisiteConceptIds: ["liabilities", "free-cash-flow"],
  dataMetricKey: "metric:debt_service_ratio",
  status: "published",
  lesson: {
    intro:
      "You've seen what your household owes in total (liabilities) and what it generates after operating costs (free cash flow). Debt pressure asks a narrower, more urgent question: of the money coming in each month, how much is already spoken for by required debt payments?",
    standardTerm:
      "Analysts and lenders call this family of measures “debt service” ratios — required debt payments compared against income. It's one of the first things a lender checks before extending new credit, because it shows how much strain existing obligations already create.",
    whyItMattersExtended:
      "Debt pressure sits alongside four related ideas this module introduces briefly and defines fully in their own glossary entries. Short-term obligations are what's due before your next expected income, debt payments included. Financial flexibility is the room a household has to absorb surprises or seize opportunities without borrowing. Retained cash is the portion of free cash flow a household kept as cash rather than allocating elsewhere. Capital allocation is the decision about where free cash flow goes — cash, investments, or debt paydown — a decision debt pressure directly constrains.",
    calculation: {
      formula: "Required debt payments ÷ revenue = debt pressure",
      walkthrough:
        "Add up the required monthly payments on loans and credit cards — minimums, not total balances, and not housing, which PFI measures separately so it's counted once. Divide that sum by monthly revenue. The result, as a percentage, is debt pressure.",
    },
    genericExample:
      "Sample figures: the Rivera household's non-housing required debt payments — the car loan, student loan, and credit-card minimum — come to $310 a month, against $6,200 of revenue. Their debt pressure is $310 ÷ $6,200 ≈ 5% in this sample scenario.",
    personalApplication: {
      metricKey: "metric:debt_service_ratio",
      interpretationRules:
        "State the share plainly, e.g. “about X% of revenue goes to required debt payments.” No debt is a valid state — if a household carries no required debt payments, report that there is nothing to service, not a percentage framed as an achievement. Improvement means the share fell; say specifically whether that's because payments dropped (debt paid down or refinanced) or because revenue rose, since the two describe different situations. Unavailable: name the missing data (debt accounts or income transactions); never estimate.",
      requiresData: ["debt-accounts", "income-transactions"],
    },
    commonMisunderstanding:
      "Debt pressure is not the same as total debt. The Rivera household's $12,000 car loan is a small piece of their $212,000 total liabilities, but if its required payment were high relative to income, it could create more monthly pressure than the much larger mortgage balance, which carries a manageable payment. Pressure is about the required payment against income, not the size of what's owed.",
    knowledgeCheck: [
      {
        kind: "interpretation",
        prompt:
          "Household A owes a $250,000 mortgage with payments equal to 12% of revenue. Household B owes $8,000 in credit-card balances with payments equal to 22% of revenue. Which household has more debt pressure?",
        choices: [
          "Household B — its required payments claim a larger share of its revenue",
          "Household A — it owes far more in total",
          "They have equal debt pressure, since both carry some debt",
          "It's impossible to compare without knowing their net worth",
        ],
        correctIndex: 0,
        explanation:
          "Debt pressure compares required payments against revenue, not the size of the balance owed. Household B's smaller balance carries a much heavier required payment relative to its income, so it faces more pressure despite owing far less in total.",
      },
      {
        kind: "which-action",
        prompt: "Which action would reduce a household's debt pressure next month?",
        choices: [
          "Refinancing a loan to a lower required monthly payment",
          "Moving cash from checking into savings",
          "Paying the full statement balance instead of the minimum, one time",
          "Checking the loan balance more often",
        ],
        correctIndex: 0,
        explanation:
          "Debt pressure moves only when the required payment or revenue changes. Refinancing to a lower required payment reduces it directly; moving cash between accounts or checking a balance doesn't change what's required, and a one-time extra payment doesn't change the ongoing required minimum.",
      },
    ],
    reinforcementPreview:
      "Debt pressure is measured by the Debt burden metric inside your PFI Score's Debt dimension, and connects to short-term obligations, financial flexibility, retained cash, and capital allocation — this module's remaining terms, each covering one more piece of how a household manages what it owes and what it keeps.",
  },
};
