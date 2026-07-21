// src/lib/concepts/content/assets.ts
import type { FinancialConcept } from "../types";

export const assets: FinancialConcept = {
  id: "assets",
  title: "Assets",
  classification: "standard_finance" as const,
  shortDefinition: "Everything your household owns that has monetary value.",
  fullDefinition:
    "An asset is anything your household owns that has monetary value — cash in an account, a home, a car, an investment balance, or any other thing of value you hold. Assets are what a household owns, as distinct from what it owes (liabilities) or how quickly a given asset can be turned into spendable cash (liquidity).",
  whyItMatters:
    "Assets are one half of the picture of household wealth. Knowing what your household owns, and how that ownership is spread across cash, property, and investments, is the starting point for understanding net worth and for judging how resilient your household's financial position is.",
  businessContext:
    "Assets are the left side of a company's balance sheet. Investors don't just look at the total — they read the composition: how much is cash versus inventory versus long-term property, because those categories behave very differently in a downturn. The same is true for a household's assets.",
  commonMisunderstanding:
    "An asset's value is not the same as cash in hand. A car is an asset because it has monetary value, but you can't pay rent with it today — turning it into spendable cash takes time and effort. That distinction between owning value and being able to spend it right now is liquidity, covered later in this module.",
  relatedConceptIds: ["liabilities", "net-worth", "liquidity"],
  prerequisiteConceptIds: [],
  status: "published",
  lesson: {
    opening:
      "If someone asked you to list everything your household owns that's worth money — your checking account, your car, your home, your retirement account — you'd be listing its assets. That's the whole idea: an asset is anything of monetary value your household owns.",
    standardTerm:
      "“Assets” is the standard business and accounting term for everything an entity owns that has monetary value. It appears on every balance sheet, whether for a household, a small business, or a public company, and it's always paired with the question of what's owed against it.",
    calculation: {
      formula: "Assets = cash + property + investments + other things of value owned",
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
    reinforcementPreview:
      "Assets are the foundation for net worth, later in this module, and will appear alongside liabilities anywhere PFI shows household balance data. A fully personalized view of your own assets arrives as PFI's balance-tracking coverage expands beyond today's cash-flow data.",
  },
};
