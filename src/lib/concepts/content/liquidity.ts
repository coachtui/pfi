// src/lib/concepts/content/liquidity.ts
import type { FinancialConcept } from "../types";

export const liquidity: FinancialConcept = {
  id: "liquidity",
  title: "Liquidity",
  classification: "household_adaptation" as const,
  shortDefinition: "How quickly your household's money can be used — cash you can spend now versus value that takes time to unlock.",
  fullDefinition:
    "Liquidity describes how quickly an asset can be turned into spendable cash without a loss of value. Cash in a checking account is fully liquid — it can be used immediately. A home or a retirement account is far less liquid: turning either into spendable cash takes time, paperwork, or may come with a penalty or a sale price you don't control. A household's overall liquidity is about how much of its value sits in that readily usable form.",
  whyItMatters:
    "Liquidity determines whether a household can meet a near-term need — rent, an emergency repair, a medical bill — without selling something at a bad time or going into debt. A household can be wealthy on paper and still be caught short if that wealth isn't liquid.",
  businessContext:
    "Companies fail from running out of liquid cash far more often than from having too few assets on paper. Analysts specifically track a company's current ratio and quick ratio — measures of liquid assets against near-term obligations — separately from its total asset value, because the two tell very different stories.",
  commonMisunderstanding:
    "Wealthy is not the same as liquid. A household rich in home equity can still miss a rent payment if none of that value is available as cash. A household's total balance can even rise while its liquidity weakens, if more and more of that balance is committed to near-term obligations rather than sitting available.",
  relatedConceptIds: ["assets", "short-term-obligations", "available-capital"],
  prerequisiteConceptIds: ["assets"],
  dataMetricKey: "metric:liquid_runway_months",
  status: "published",
  lesson: {
    opening:
      "Owning something valuable and being able to spend that value today are two different things. A home is worth a lot, but you can't hand a piece of it to a landlord tomorrow. That gap — between owning value and being able to use it right now — is what liquidity measures.",
    standardTerm:
      "“Liquidity” is the standard business and investing term for how quickly an asset converts to cash without losing value. Cash is the most liquid asset there is; real estate and long-term investments sit at the illiquid end of the spectrum. Businesses and households are both judged partly on how liquid their position is, separately from how much they're worth overall.",
    calculation: {
      formula: "Liquid assets ÷ monthly essential expenses = emergency runway (months)",
      walkthrough:
        "PFI's main liquidity gauge asks: if income stopped today, how many months could this household cover its essential costs using only what's already liquid? Essential expenses are a must-pay subset of total spending — PFI counts only the spending flagged essential, not every dollar spent. Take the household's liquid assets — cash readily available in checking and savings — and divide by its typical monthly essential expenses. The result is emergency runway, expressed in months.",
    },
    genericExample:
      "Sample figures: the Rivera household's total monthly operating expenses are $4,750, but not all of that is must-pay. Their monthly essential expenses — rent, utilities, groceries, insurance, and minimum debt payments — come to $3,100, a subset of the $4,750 total. With $9,300 in liquid assets (checking and savings), their emergency runway is $9,300 ÷ $3,100 = 3.0 months in this sample scenario — the length of time they could cover essential costs from liquid cash alone if income stopped.",
    personalApplication: {
      metricKey: "metric:liquid_runway_months",
      interpretationRules:
        "Express the runway plainly in months, e.g. “about X months of essential expenses covered by liquid assets.” When runway is below roughly one month, state that factually — the household has little liquid buffer — without alarm language. Unavailable: name the missing data (balance history or spending transactions); never estimate.",
      requiresData: ["balance-history", "spending-transactions"],
    },
    commonMisunderstanding:
      "Being wealthy is not the same as being liquid. A household with substantial home equity and retirement savings can still be unable to cover an unexpected bill next week if none of that value is in a liquid form. A household's total balance can even climb while its liquidity weakens, if a growing share of that balance is committed to near-term obligations rather than sitting available as cash.",
    knowledgeChecks: [
      {
        id: "liquidity-check-1",
        kind: "interpretation",
        prompt:
          "Two households have the same net worth. One holds most of it as home equity; the other holds six months of essential expenses in cash. Which household is more liquid, and why?",
        choices: [
          "The household with six months of cash — liquidity measures how quickly value can be spent, not how much value exists",
          "Neither — they're equally liquid, since net worth is identical",
          "The household with more home equity, because real estate typically holds its value well",
          "It's impossible to compare liquidity without knowing their incomes",
        ],
        correctIndex: 0,
        explanation:
          "Net worth measures total value owned; liquidity measures how quickly that value converts to spendable cash. Six months of cash is far more liquid than the same value locked in home equity, even though both households have identical net worth.",
      },
      {
        id: "liquidity-check-2",
        kind: "which-action",
        prompt: "Which action would increase a household's liquidity?",
        choices: [
          "Moving investment gains into a savings account",
          "Buying a car outright with cash",
          "Prepaying a full year of insurance premiums in one lump sum",
          "Any of these — they all move money, so all increase liquidity equally",
        ],
        correctIndex: 0,
        explanation:
          "Moving investment gains into a savings account converts less-liquid value into cash, increasing liquidity. Buying a car with cash or prepaying a year of insurance does the opposite — it converts liquid cash into a less liquid asset or a committed obligation.",
      },
    ],
    reinforcementPreview:
      "Liquidity is measured by the Emergency runway metric inside your PFI Score's Liquidity & Resilience dimension, and connects to short-term obligations and available capital — both defined in the glossary wherever they appear in PFI.",
  },
};
