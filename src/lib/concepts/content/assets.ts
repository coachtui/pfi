// src/lib/concepts/content/assets.ts
import type { FinancialConcept } from "../types";

export const assets: FinancialConcept = {
  id: "assets",
  title: "Assets",
  classification: "standard_finance" as const,
  shortDefinition: "Everything your household owns that has monetary value.",
  plainEnglishSummary:
    "Everything the household owns that holds value: cash, investments, and property.",
  memorableDistinction: "Assets are what you own; liabilities are what you owe.",
  fullDefinition:
    "An asset is anything your household owns that has monetary value — cash in an account, a home, a car, an investment balance, or any other thing of value you hold. Assets are what a household owns, as distinct from what it owes (liabilities) or how quickly a given asset can be turned into spendable cash (liquidity).",
  whyItMatters:
    "Assets are one half of the picture of household wealth. Knowing what your household owns, and how that ownership is spread across cash, property, and investments, is the starting point for understanding net worth and for judging how resilient your household's financial position is.",
  formula: "Assets = cash + property + investments + other things of value owned",
  formulaRows: [
    { label: "Home", staticValue: "$225,000" },
    { label: "Liquid cash (checking + savings)", operator: "+", staticValue: "$9,300" },
    { label: "Retirement account", operator: "+", staticValue: "$18,000" },
    { label: "Vehicle and other items", operator: "+", staticValue: "$7,700" },
    { label: "Total assets", operator: "=", staticValue: "$260,000" },
  ],
  comparisonRows: [
    {
      label: "Cash, checking, and savings",
      included: true,
      explanation: "Money already sitting in the household's own accounts, ready to use.",
    },
    {
      label: "Investment and retirement accounts",
      included: true,
      explanation:
        "Value the household has built up in an account it owns, even though it isn't spendable today without a withdrawal.",
    },
    {
      label: "Home and vehicle value",
      included: true,
      explanation: "Property the household owns outright in value, separate from any loan still owed against it.",
    },
    {
      label: "A credit-card balance",
      included: false,
      explanation: "Money owed to a lender, not something the household owns — it belongs on the liabilities side.",
    },
    {
      label: "An outstanding loan",
      included: false,
      explanation: "An obligation to repay someone else, which reduces net worth rather than adding to it.",
    },
  ],
  interpretation:
    "A larger asset base is only one side of net worth — a household's financial position also depends on what it owes against those assets, covered next in this module. A home is the clearest example: its full value counts as an asset, while any mortgage balance is tracked separately as a liability, so owning a valuable home doesn't by itself say much about financial health. It also matters where a rise in asset value comes from, and the mechanics differ by asset type. An investment, retirement, or savings balance grows in a way the household directly controls: depositing money into one of these accounts is value the household created through its own behavior. A home's own asset value doesn't work that way — making a mortgage payment doesn't raise what the home itself is worth; paying down a mortgage builds net worth on the liabilities side, by reducing what's owed, not by adding to the asset figure. What actually moves a home's asset value is largely the housing market: when home prices rise on their own, that's market appreciation — real, but not something the household did — and the same kind of appreciation can lift an investment balance too, when markets move on their own rather than because of a deposit. Both owner-created contributions and market appreciation add to the same asset figure, so it's worth keeping the two apart rather than reading every increase as a sign of household progress.",
  businessContext:
    "Assets are the left side of a company's balance sheet. Investors don't just look at the total — they read the composition: how much is cash versus inventory versus long-term property, because those categories behave very differently in a downturn. The same is true for a household's assets.",
  commonMisunderstanding:
    "An asset's value is not the same as cash in hand. A car is an asset because it has monetary value, but you can't pay rent with it today — turning it into spendable cash takes time and effort. That distinction between owning value and being able to spend it right now is liquidity, covered later in this module.",
  whereUsed: ["Household balance sheet (Report)", "Net worth calculation", "Liquidity assessment"],
  relatedConceptIds: ["liabilities", "net-worth", "liquidity"],
  prerequisiteConceptIds: [],
  status: "published",
  lesson: {
    opening:
      "If someone asked you to list everything your household owns that's worth money — your checking account, your car, your home, your retirement account — you'd be listing its assets. That's the whole idea: an asset is anything of monetary value your household owns.",
    standardTerm:
      "“Assets” is the standard business and accounting term for everything an entity owns that has monetary value. It appears on every balance sheet, whether for a household, a small business, or a public company, and it's always paired with the question of what's owed against it.",
    calculation: {
      walkthrough:
        "List every account and item of value your household owns: cash in checking and savings, a home or vehicle at its current value, balances in investment or retirement accounts, and anything else with resale or monetary value. Add them together and you have total assets.",
    },
    genericExample:
      "Sample figures: the Rivera household owns a home worth $225,000, has $9,300 in liquid cash across checking and savings, holds $18,000 in a retirement account, and owns a car and other smaller items worth $7,700. Added together, their total assets come to $225,000 + $9,300 + $18,000 + $7,700 = $260,000 in this sample scenario — the starting figure this module's net worth lesson builds on.",
    commonMisunderstanding:
      "Owning valuable assets does not mean you have cash available. A household can be asset-rich — a paid-off home, a strong retirement balance — and still struggle to cover an unexpected bill next week, because most of that value isn't sitting in cash. Assets measure what's owned, not what's immediately spendable.",
    knowledgeChecks: [
      {
        id: "assets-check-1",
        kind: "identify-figure",
        prompt: "Sample figures: which of the following is an asset for a household?",
        choices: ["A $9,300 savings account balance", "A $1,800 credit-card balance", "A $1,400 monthly rent payment", "A $6,200 monthly salary"],
        correctIndex: 0,
        explanation:
          "A savings balance is money the household owns, so it's an asset. A credit-card balance is owed to someone else (a liability), rent is an expense, and salary is revenue — none of those are things the household owns.",
      },
    ],
    completionSummary:
      "You can now identify what your household owns and see how assets pair with liabilities to form net worth.",
  },
};
