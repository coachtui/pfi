// src/lib/concepts/content/net-worth.ts
import type { FinancialConcept } from "../types";

export const netWorth: FinancialConcept = {
  id: "net-worth",
  title: "Net worth",
  classification: "household_adaptation" as const,
  shortDefinition: "What your household owns minus what it owes — also called household equity.",
  plainEnglishSummary:
    "What the household owns minus what it owes, measured at a point in time.",
  memorableDistinction: "Net worth is a level, not a paycheck.",
  fullDefinition:
    "Net worth is what your household owns (assets) minus what it owes (liabilities). It is also called household equity — the same concept as shareholder equity in a business, just applied to a household instead of a company. Net worth is a snapshot at a point in time, not a flow: it captures where things stand today, the way assets and liabilities do, rather than what moved during a period.",
  whyItMatters:
    "Net worth is the single number that combines everything a household owns and owes into one measure of financial position. It's the household equivalent of shareholder equity — the number investors watch to see whether a company's ownership stake is growing or shrinking over time.",
  formula: "Assets − liabilities",
  formulaRows: [
    { label: "Total assets", staticValue: "$260,000" },
    { label: "Total liabilities", operator: "-", staticValue: "$212,000" },
    { label: "Net worth", operator: "=", staticValue: "$48,000" },
  ],
  comparisonRows: [
    {
      label: "Assets minus liabilities",
      included: true,
      explanation: "The base calculation itself — everything owned less everything owed, at a point in time.",
    },
    {
      label: "Equity built by paying down debt",
      included: true,
      explanation: "Owner-created: reducing a liability raises net worth even though what's owned hasn't changed.",
    },
    {
      label: "A gain from rising home or market value",
      included: true,
      explanation: "Market appreciation: assets rise on their own, not through household action, but it still raises the same number.",
    },
    {
      label: "This month's income",
      included: false,
      explanation: "A flow over a period, not a balance-sheet snapshot — income isn't captured directly in net worth.",
    },
    {
      label: "Money in checking right now",
      included: false,
      explanation: "Only one slice of total assets, not the full owned-minus-owed calculation.",
    },
  ],
  interpretation:
    "Net worth is a stock measured at a moment, not a flow, and it can rise for three distinct reasons that are worth telling apart. Paying down debt reduces liabilities, which raises net worth even though it doesn't change what the household owns — that's owner-created, built through behavior. Depositing into savings, an investment account, or a retirement account raises assets directly, which also raises net worth — also owner-created. But a home's value or an investment balance can rise simply because the market moved on its own, with no action from the household at all — that's market appreciation, not something the household did. All three show up as the same single number going up, so a rising net worth is healthy but doesn't by itself say how it got there — only the first two reflect real household behavior.",
  businessContext:
    "Net worth takes the same form as shareholder equity on a company's balance sheet: assets minus liabilities equals equity. When people talk about a company or household “building equity,” they mean growing this exact number — increasing what's owned relative to what's owed.",
  commonMisunderstanding:
    "Net worth is not cash and not income. It can grow while cash on hand is tight — for example, when a mortgage payment reduces a liability, that paydown moves value onto the equity side even though it also reduces the checking balance. And net worth can shrink even during a high-income period if liabilities grow faster than assets. Net worth measures position, not cash flow.",
  whereUsed: ["Household balance sheet (Report)", "Baseline and Waterline framing", "Long-run progress view"],
  relatedConceptIds: ["assets", "liabilities", "free-cash-flow"],
  prerequisiteConceptIds: ["assets", "liabilities"],
  dataMetricKey: "snapshot:netWorth",
  status: "published",
  lesson: {
    opening:
      "You've now seen what a household owns (assets) and what it owes (liabilities). Net worth is simply the difference between the two — one number that summarizes a household's overall financial position at a point in time.",
    standardTerm:
      "“Net worth” is the standard term for assets minus liabilities. In business and investing, the identical calculation is called shareholder equity — net worth is household equity, the same concept applied to a household instead of a company. “Building equity” means growing this number.",
    calculation: {
      formula: "Assets − liabilities = net worth",
      walkthrough:
        "Take everything your household owns (its total assets) and subtract everything it owes (its total liabilities). The result is net worth. A positive net worth means the household owns more than it owes; a negative net worth means the reverse.",
    },
    genericExample:
      "Sample figures: the Rivera household has $260,000 in assets and $212,000 in liabilities. Their net worth is $260,000 − $212,000 = $48,000. That $48,000 is their household equity in this sample scenario — what would be left over if every asset were sold and every liability paid off.",
    personalApplication: {
      metricKey: "snapshot:netWorth",
      interpretationRules:
        "State the current net worth figure and its recent direction — rising, falling, or roughly flat. Wherever the underlying data distinguishes the two, separate owner-created change (contributions, debt paydown) from market movement (a home or investment simply changing in value) rather than presenting them as a single undifferentiated number — these represent different things and should never be conflated. Unavailable: name the missing data (balance history); never estimate.",
      requiresData: ["balance-history"],
    },
    commonMisunderstanding:
      "Net worth is not the same as cash and not the same as income. It can rise during a month when cash feels tight — paying down a mortgage moves money out of checking but reduces a liability, which increases equity by the same amount. Net worth can also fall during a high-income period if liabilities grow faster than assets. Watch the balance-sheet position, not the checking-account feeling.",
    knowledgeChecks: [
      {
        id: "net-worth-check-1",
        kind: "identify-figure",
        prompt: "Sample figures: a household has $260,000 in assets and $212,000 in liabilities. What is its net worth?",
        choices: ["$48,000", "$260,000", "$212,000", "$472,000"],
        correctIndex: 0,
        explanation: "Net worth = assets − liabilities = $260,000 − $212,000 = $48,000.",
      },
      {
        id: "net-worth-check-2",
        kind: "interpretation",
        prompt: "A household's net worth rose this month even though its checking account balance fell. What most likely explains this?",
        choices: [
          "A mortgage or loan payment reduced a liability, moving value onto the equity side of the balance sheet",
          "The household's net worth figure must be wrong",
          "Net worth and checking balance always move together",
          "The household earned no income this month",
        ],
        correctIndex: 0,
        explanation:
          "Paying down a mortgage or loan reduces the checking balance but also reduces liabilities by the same amount, which increases net worth — cash moved into equity rather than disappearing.",
      },
    ],
    completionSummary:
      "You can now read net worth as owned-minus-owed at a point in time, and separate the equity your household built from the effect of market movement.",
  },
};
