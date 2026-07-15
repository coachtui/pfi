# Financial Health Score

Status: **specified, not yet implemented** (Phase 2). This document is the provisional spec.

## What it is

A 0–900 score measuring **personal financial operating health** — the current condition and direction of a household's finances.

**This is not a credit score and must never be described as one.** It measures neither wealth nor creditworthiness nor personal worth.

## Dimensions (from the product addendum)

| Dimension | Provisional weight | Measures |
|---|---|---|
| Cash Flow Health | 25% | savings rate, recurring net cash flow, fixed vs variable expenses, volatility |
| Liquidity & Emergency Resilience | 20% | liquid runway, accessible reserves, dependence on credit |
| Debt Health | 20% | debt-service ratio, utilization, interest burden, trajectory |
| Stability | 15% | income consistency, income concentration, fixed-cost burden |
| Growth & Wealth Building | 10% | contribution consistency, owner-created equity, goal progress |
| Protection | 5% | insurance/estate indicators — conservative, user-provided data only |
| Concentration & Exposure | 5% | income/asset/institution concentration (identify, never auto-recommend trades) |

Momentum modifies the presentation (improving/declining) and is scored inside each dimension's trend, not as a hidden multiplier.

## Requirements (binding on the implementation)

- Every score change must be explainable: previous score, new score, change by dimension, specific metrics that moved, one-time events, data-quality caveats — produced **deterministically before** any AI narration (score-delta engine, Phase 3).
- Component scores are always visible.
- Never rank users on absolute wealth.
- Don't punish temporary, intentional decisions (e.g., a planned large purchase) — the user's stated objective informs recommendations but **never manipulates raw metrics**.
- Missing data lowers **confidence**, not silently the score; material gaps must be disclosed (see data-coverage model below).
- The scoring formula is versioned (`PFI_SCORE_VERSION`). Every stored score records the version that produced it. Methodology changes never silently rewrite history — keep the original score, the version, and (where appropriate) a recalculated comparable score with an explanation.

## Score confidence / data coverage

Confidence derives from: number of connected accounts, presence of income and debt data, sync freshness, history length, categorization confidence, unresolved transfers, and user-confirmed assumptions. Displayed as High / Moderate / Limited with a plain-language reason and a list of what would improve accuracy.

## Metric registry

Phase 2 implements metrics behind a registry (id, label, compute, format, assumptions, confidence) so new metrics can be added without rewriting the dashboard. Initial metrics: savings margin, free-cash-flow margin, debt-service ratio, fixed-cost ratio, credit utilization, liquid runway, expense volatility, income consistency, drawdown, owner-created equity, investment-contribution consistency, momentum.
