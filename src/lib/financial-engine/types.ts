/**
 * Core types for the deterministic financial calculation engine.
 *
 * This module is intentionally framework-free (no React, no Next.js) so it
 * can later be extracted into a shared package (`packages/financial-engine`)
 * consumed by both the web app and a future native app.
 */

/** ISO date string, e.g. "2026-07-15" (always UTC calendar dates). */
export type ISODate = string;

/**
 * One derived snapshot per day. Stored/derived values, never recalculated
 * from raw transactions on every request.
 */
export interface DailySnapshot {
  date: ISODate;
  /** Cash and immediately available savings. */
  liquidAssets: number;
  /** Revolving balances (credit cards, lines of credit). */
  revolvingBalances: number;
  /** All obligations due before the next expected income event. */
  nearTermObligations: number;
  /** The essential subset of near-term obligations (rent, utilities, minimums…). */
  essentialObligations: number;
  /** User-defined or system-estimated safety buffer in dollars. */
  safetyBuffer: number;
  /** Total assets minus total liabilities. Not used by the index in v1. */
  netWorth: number;
}

export type FinancialEventType =
  | "paycheck"
  | "bonus"
  | "mortgage_payment"
  | "large_purchase"
  | "insurance_payment"
  | "investment_contribution"
  | "debt_payment"
  | "debt_payoff"
  | "tax_payment"
  | "unexpected_expense";

export interface FinancialEvent {
  id: string;
  date: ISODate;
  type: FinancialEventType;
  label: string;
  /** Positive dollar magnitude; sign is carried by `direction`. */
  amount: number;
  direction: "inflow" | "outflow";
}

/** A single point on the indexed chart. */
export interface IndexPoint {
  date: ISODate;
  /** Indexed actual available financial position. */
  actual: number;
  /** Indexed personal baseline (expected position from own history). */
  baseline: number | null;
  /** Indexed financial waterline (minimum safe position). */
  waterline: number;
}

/** Parameters that anchor dollar values to index space. */
export interface IndexAnchor {
  /** Anchor value A: the reference dollar position mapped to index 100. */
  anchorValue: number;
  /** Scale S: dollars represented by 100 index points. Always > 0. */
  scale: number;
  /** How the anchor was derived — surfaced to the user in "How is this calculated?". */
  method: "median-first-30-days" | "median-full-history" | "insufficient-history";
}

export type MomentumDirection = "improving" | "stable" | "declining";

export interface Momentum {
  direction: MomentumDirection;
  /** Index-point change between the recent window average and the prior window average. */
  delta: number;
  /** Window length in days used on each side of the comparison. */
  windowDays: number;
}

/** Deterministic driver of index movement over a period (input to the AI explanation layer). */
export interface Driver {
  event: FinancialEvent;
  /** Signed dollar impact on available position (+ improves, − reduces). */
  impact: number;
}

export interface PositionStatus {
  /** Above or below the personal baseline (own historical average). */
  vsBaseline: "above" | "below" | "at";
  /** Above or below the waterline. Below-baseline and underwater are distinct conditions. */
  vsWaterline: "above" | "below" | "at";
}
