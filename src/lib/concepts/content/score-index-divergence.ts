// src/lib/concepts/content/score-index-divergence.ts
import type { FinancialConcept } from "../types";

export const scoreIndexDivergence: FinancialConcept = {
  id: "score-index-divergence",
  title: "PFI vs Fundamentals Score",
  classification: "pfi_metric",
  shortDefinition:
    "PFI and your Fundamentals Score can move in opposite directions on the same day — they track different time horizons, not different opinions.",
  plainEnglishSummary:
    "PFI reacts to what happened today; your Fundamentals Score reflects the last 90 days. A short-term cash swing can move one without moving the other.",
  memorableDistinction: "PFI reacts today; the Fundamentals Score remembers the last 90 days.",
  fullDefinition:
    "PFI behaves like a daily share price: it reacts to recent cash movement, including one-time swings. The Fundamentals Score is a 90-day financial-health rating built from steadier patterns like liquidity and debt pressure. Because they measure different things over different windows, they can disagree on any given day without either one being wrong.",
  whyItMatters:
    "Without this distinction, a single large expense can look like a crisis, or a single good day can look like lasting progress. Knowing PFI and the Fundamentals Score answer different questions keeps a short-term swing from being mistaken for a real change in your household's underlying health.",
  businessContext:
    "Traders use the word \"divergence\" for exactly this pattern: when a price and an underlying indicator move in different directions, it's often read as a sign that a headline move doesn't match the underlying trend — not that either measurement is broken.",
  whereUsed: ["Home dashboard's divergence explainer line"],
  relatedConceptIds: ["cash-flow", "liquidity"],
  prerequisiteConceptIds: [],
  status: "published",
  lesson: {
    openingHeading: "What is a divergence?",
    opening:
      "You pay a large bill and watch PFI drop that same day. But your Fundamentals Score doesn't move — it might even keep improving. Which one is telling the truth? Both. They're just answering different questions.",
    standardTerm:
      "In investing, \"divergence\" describes a price and an indicator moving in different directions — a classic signal that a headline number and the underlying trend aren't saying the same thing. PFI vs. Fundamentals Score is that same pattern, applied to your household.",
    whyItMattersExtended:
      "PFI is built to react — it's the number that shows you today's cash movement. The Fundamentals Score is built to hold steady — it only shifts when your underlying pattern, not a single day, actually changes. Reading a divergence correctly means checking which number is answering the question you're actually asking.",
    genericExample:
      "Sample household: the Rivera household pays a $1,200 annual insurance premium in one day. PFI drops several points that same day, because it reacts to the cash leaving the account. Their Fundamentals Score doesn't move, because their spending and saving pattern over the last 90 days hasn't actually changed — one payment isn't a trend.",
    commonMisunderstanding:
      "It can feel like the two numbers are contradicting each other, or that one of them must be wrong. They're not disagreeing — PFI is answering \"what happened today\" and the Fundamentals Score is answering \"how healthy is my household overall, over the last 90 days.\" Different questions can have different answers on the same day.",
    knowledgeChecks: [
      {
        id: "score-index-divergence-check-1",
        kind: "interpretation",
        prompt:
          "Your PFI drops 4 points today after a large one-time payment, but your Fundamentals Score keeps improving. What's the best read?",
        choices: [
          "They track different time horizons, so this is expected",
          "The Fundamentals Score must be wrong",
          "This means you should be worried",
          "PFI is the more accurate number of the two",
        ],
        correctIndex: 0,
        explanation:
          "PFI reacts to today's cash movement; the Fundamentals Score reflects your last 90 days. A single large payment can move one without moving the other — that's expected, not a contradiction.",
      },
      {
        id: "score-index-divergence-check-2",
        kind: "which-action",
        prompt:
          "You notice PFI and your Fundamentals Score pointing in opposite directions this week. What's the right next step?",
        choices: [
          "Check whether your underlying pattern has actually changed over recent weeks, not just today",
          "Immediately cut spending until the two numbers agree",
          "Ignore the Fundamentals Score until PFI recovers",
          "Assume the dashboard has a bug and wait for it to fix itself",
        ],
        correctIndex: 0,
        explanation:
          "A one-day divergence is normal. The useful question is whether your actual pattern — not just today's number — has changed, which is exactly what the Fundamentals Score is built to answer.",
      },
    ],
    completionSummary:
      "You can now read a PFI/Fundamentals Score divergence as a normal signal about time horizons, not a contradiction.",
  },
};
