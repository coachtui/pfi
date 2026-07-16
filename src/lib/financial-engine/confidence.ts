/**
 * Per-dimension confidence derivation. Deterministic; rules are normative
 * in docs/FINANCIAL_HEALTH_SCORE.md ("Confidence / data coverage").
 */
import { WINDOW_DAYS, type MetricInputs } from "./metric-inputs";
import type { ConfidenceLevel, DimensionKey, MetricResult } from "./score-types";

export interface ConfidenceReport {
  byDimension: Record<DimensionKey, { level: ConfidenceLevel; reasons: string[] }>;
  improvements: string[];
}

const ALL_DIMENSIONS: DimensionKey[] = ["cash_flow", "liquidity", "debt", "stability", "growth", "concentration"];
const CATEGORY_DRIVEN: ReadonlySet<DimensionKey> = new Set(["cash_flow", "stability", "growth"]);
const ORDER: ConfidenceLevel[] = ["high", "moderate", "limited"];

const IMPROVEMENTS: Array<{ match: RegExp; advice: string }> = [
  { match: /credit limit/i, advice: "Add credit limits to your credit-card accounts" },
  { match: /interest rate/i, advice: "Add interest rates to your loan and card accounts" },
  { match: /uncategorized/i, advice: "Categorize more of your transactions" },
  { match: /days of history/i, advice: "Keep your data connected — accuracy improves with history" },
  { match: /demo dataset/i, advice: "Replace demo data with your own accounts" },
  { match: /income/i, advice: "Record your income transactions" },
];

function cap(level: ConfidenceLevel, atMost: ConfidenceLevel): ConfidenceLevel {
  return ORDER[Math.max(ORDER.indexOf(level), ORDER.indexOf(atMost))];
}
function drop(level: ConfidenceLevel): ConfidenceLevel {
  return ORDER[Math.min(ORDER.indexOf(level) + 1, ORDER.length - 1)];
}

export function computeConfidence(inputs: MetricInputs, metricResults: MetricResult[]): ConfidenceReport {
  const byDimension = {} as ConfidenceReport["byDimension"];
  const allReasons: string[] = [];

  for (const key of ALL_DIMENSIONS) {
    let level: ConfidenceLevel = "high";
    const reasons: string[] = [];

    if (inputs.historyDays < 60) {
      level = cap(level, "limited");
      reasons.push("Less than 60 days of history");
    } else if (inputs.historyDays < WINDOW_DAYS) {
      level = cap(level, "moderate");
      reasons.push("Less than 90 days of history");
    }

    for (const m of metricResults) {
      if (m.dimension === key && m.scored && m.availability === "unavailable" && m.reason) {
        level = drop(level);
        reasons.push(m.reason);
      }
    }

    if (CATEGORY_DRIVEN.has(key) && inputs.dataQuality.uncategorizedShare > 0.10) {
      level = drop(level);
      reasons.push("Over 10% of transactions are uncategorized");
    }

    if (inputs.dataQuality.demo) {
      level = cap(level, "moderate");
      reasons.push("Demo dataset");
    }

    byDimension[key] = { level, reasons };
    allReasons.push(...reasons);
  }

  const improvements = [...new Set(
    allReasons.flatMap((r) => IMPROVEMENTS.filter((i) => i.match.test(r)).map((i) => i.advice)),
  )];
  return { byDimension, improvements };
}
