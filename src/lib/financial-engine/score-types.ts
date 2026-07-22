import type { ISODate } from "./types";

export const PFI_SCORE_VERSION = "1.1";

export type DimensionKey =
  | "cash_flow" | "liquidity" | "debt" | "stability" | "growth" | "concentration";

export type ConfidenceLevel = "high" | "moderate" | "limited";
export type MetricAvailability = "available" | "unavailable" | "not_applicable";

export interface MetricResult {
  id: string;
  /** Plain-language, consumer-facing name. */
  name: string;
  dimension: DimensionKey;
  /** false = explanation-only: never affects any score. */
  scored: boolean;
  availability: MetricAvailability;
  /** Raw metric value (ratio, months, CV…); null unless available. */
  value: number | null;
  formatted: string | null;
  /** 0–100 curve score; null unless scored and available. */
  curveScore: number | null;
  definition: string;
  assumptions: string[];
  limitations: string[];
  /** Why unavailable / not applicable; null when available. */
  reason: string | null;
}

export interface DimensionResult {
  key: DimensionKey;
  label: string;
  configuredWeight: number;
  eligible: boolean;
  exclusionReason: string | null;
  /** 0–100; null when ineligible — never a fabricated number. */
  score: number | null;
  confidence: ConfidenceLevel | "insufficient_data";
  confidenceReasons: string[];
  metrics: MetricResult[];
}

export type OverallState = "full" | "provisional" | "suppressed";
export type ProtectionStatus =
  | "not_assessed" | "limited_data" | "needs_review" | "adequately_documented";

export interface ScoreBreakdown {
  version: string;
  asOfDate: ISODate;
  state: OverallState;
  /** 0–900; null when suppressed. */
  overall: number | null;
  band: string | null;
  overallConfidence: ConfidenceLevel | "insufficient_data";
  configuredWeights: Record<DimensionKey, number>;
  /** Renormalized over eligible dimensions; empty when suppressed. */
  effectiveWeights: Partial<Record<DimensionKey, number>>;
  dimensions: DimensionResult[];
  protection: { status: ProtectionStatus; includedInScore: false };
  /** Provisional/suppression explanations + improvement list. */
  notes: string[];
}

export type MomentumState =
  | "strongly_improving" | "improving" | "stable" | "weakening"
  | "deteriorating" | "recovering" | "insufficient_history";

export interface DimensionDelta {
  key: DimensionKey; label: string;
  from: number | null; to: number | null; change: number | null;
}
export interface MetricMover {
  id: string; name: string; dimension: DimensionKey;
  /** Signed contribution to the 0–900 overall change. */
  overallPointsImpact: number;
}
export interface ScoreDelta {
  state: "ok" | "insufficient_history";
  from: number | null; to: number | null; change: number | null;
  dimensions: DimensionDelta[];
  topMovers: MetricMover[];
  notes: string[];
}
