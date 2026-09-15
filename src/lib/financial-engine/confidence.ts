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
const CATEGORY_DRIVEN: ReadonlySet<DimensionKey> = new Set(["cash_flow", "stability", "growth", "liquidity"]);
/** Dimensions whose windowed flows depend on correctly-paired transfers (contributions/debt payments/income netting). */
const TRANSFER_SENSITIVE: ReadonlySet<DimensionKey> = new Set(["cash_flow", "stability", "growth"]);
const ORDER: ConfidenceLevel[] = ["high", "moderate", "limited"];

/** Dimensions whose inputs are balance levels (anchors), not just flows. */
const BALANCE_DRIVEN: ReadonlySet<DimensionKey> = new Set(["liquidity", "debt", "concentration"]);

const CLEAN_SOURCES = {
  historyIncomplete: false, staleConnectedShare: 0, cachedBalanceStale: false, syncDiscrepancy: false, otherCategoryShare: 0,
} as const;

const IMPROVEMENTS: Array<{ match: RegExp; advice: string }> = [
  { match: /history is still loading/i, advice: "Wait for Plaid to finish loading your transaction history, then sync again" },
  { match: /stale or disconnected/i, advice: "Reconnect or sync your bank connections" },
  { match: /may be missing/i, advice: "Check the flagged account — its balance didn't match its transactions" },
  { match: /categorized as Other/i, advice: "Categorize the transactions marked Other" },
  { match: /balance is older/i, advice: "Sync your connections to refresh balances" },
  { match: /credit limit/i, advice: "Add credit limits to your credit-card accounts" },
  { match: /interest rate/i, advice: "Add interest rates to your loan and card accounts" },
  { match: /uncategorized/i, advice: "Categorize more of your transactions" },
  { match: /days of history/i, advice: "Keep your data connected — accuracy improves with history" },
  { match: /demo dataset/i, advice: "Replace demo data with your own accounts" },
  { match: /transfers could not be matched/i, advice: "Match or correct unpaired transfers" },
  { match: /entered manually/i, advice: "Connect accounts when available to corroborate manual data" },
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

  const sources = inputs.sourceReliability ?? CLEAN_SOURCES;

  for (const key of ALL_DIMENSIONS) {
    let level: ConfidenceLevel = "high";
    const reasons: string[] = [];

    // Source reliability first (Plaid Slice 1, spec §10): PFI's own facts
    // about its sources — never Plaid's category confidence.
    if (sources.historyIncomplete) {
      level = cap(level, "limited");
      reasons.push("Transaction history is still loading from Plaid");
    }
    if (sources.staleConnectedShare > 0) {
      level = drop(level);
      reasons.push("Some connected accounts are stale or disconnected");
    }
    if (BALANCE_DRIVEN.has(key) && sources.cachedBalanceStale) {
      level = drop(level);
      reasons.push("A synced balance is older than the score date");
    }
    if ((TRANSFER_SENSITIVE.has(key) || key === "liquidity") && sources.syncDiscrepancy) {
      level = drop(level);
      reasons.push("Some synced transactions may be missing (a balance didn't reconcile)");
    }
    if (CATEGORY_DRIVEN.has(key) && sources.otherCategoryShare > 0.25) {
      level = drop(level);
      reasons.push("Over 25% of spending is categorized as Other");
    }

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

    if (TRANSFER_SENSITIVE.has(key) && inputs.dataQuality.unresolvedTransferShare > 0.05) {
      level = drop(level);
      reasons.push("Some transfers could not be matched");
    }

    if (inputs.dataQuality.manualShare > 0.8) {
      level = drop(level);
      reasons.push("Most data was entered manually");
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
