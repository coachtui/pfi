# Phase 2 Financial Engine — Design (2026-07-16)

Slice: metric registry + PFI score v1 + score-delta explanations + confidence model + Momentum overlay + Protection status, surfaced as a dashboard score card and a `/score` screen.

**Normative companion:** `docs/FINANCIAL_HEALTH_SCORE.md` (v1.0) owns all scoring rules — dimensions, weights, formulas, curves, eligibility, missing-data policy, momentum states, confidence derivation, bands, edge cases, and the required test list. This design doc covers architecture, data flow, UI, and testing strategy; it never restates curve numbers.

## Decisions locked during brainstorming (2026-07-16)

1. **UI scope:** dashboard score card + dedicated `/score` screen.
2. **Missing data:** eligibility + reweighting + disclosure (per the revised framework's §11 recommended behavior: Cash Flow + Liquidity required, ≥4/6 eligible, provisional labels, suppression otherwise). Never neutral-fill or cap.
3. **Persistence:** compute at read time; no migration; no `health_score` columns (DECISIONS #14).
4. **Delta period:** follows the shared 30D/90D/1Y/All range picker (reuses `Segmented`).
5. **Architecture:** layered pure pipeline with a declarative metric registry (approach A).
6. **Revised framework adopted** (user-provided, 2026-07-16): six weighted dimensions; Protection unscored with status display; Momentum as overlay; per-dimension confidence; anti-double-counting ownership table; consumer-facing terminology.

## Engine architecture

Six new framework-free modules in `src/lib/financial-engine/` (flat files + colocated tests, matching the existing pattern; no React/Next imports):

- **`metric-inputs.ts`** — `MetricInputs` + `buildMetricInputs(snapshots, transactions, accounts, events, asOfDate)`. Single place that knows row shapes: windowed transaction slices (transfer-excluded, override-aware effective categories, refunds netted), monthly income/outflow series, account groupings (eligible-liquid per spec, revolving, debt, investment), snapshot series. Pure; safe on empty inputs.
- **`metrics.ts`** — the registry. One declarative entry per metric: `{ id, name (plain-language), definition, compute(inputs) → number | null | "not_applicable", format, assumptions, limitations, guidance, scored, dimension }`. `computeMetrics(inputs) → MetricResult[]`. `null` = unavailable (drives eligibility/confidence); `"not_applicable"` = known-good absence (debt-free rule).
- **`scoring.ts`** — piecewise-linear curves with the spec's anchor points, the six `DIMENSIONS` with configured weights, eligibility rules, `PFI_SCORE_VERSION = "1.0"`, score bands, and `computeScore(metricResults) → ScoreBreakdown`. `ScoreBreakdown` carries the full audit payload: overall score | `provisional` | `suppressed` state, configured + effective weights, per-dimension `{score, eligible, exclusionReason, confidence, metrics[]}`, protection status (`not_assessed` in v1), version, as-of date.
- **`momentum-overlay.ts`** — `computeScoreMomentum({ current, prior30, prior60 }: { current: number | null; prior30: number | null; prior60: number | null }) → MomentumState`, taking overall-score points supplied by the caller (null = not scoreable at that date) and implementing the spec's state machine (7 states incl. `insufficient_history`). Never feeds the weighted score.
- **`score-delta.ts`** — `computeScoreDelta(current, previous) → ScoreDelta`: total change, per-dimension changes, top metric movers with signed contributions, one-time-event flags, data-caveat notes. Pure structural diff of two `ScoreBreakdown`s; range-start breakdown is `computeScore` on inputs filtered to data existing at that date. Insufficient history for a range → explicit `insufficient_history` result, never a zero baseline.
- **`confidence.ts`** — per-dimension + overall confidence per the spec (history length, metric availability, categorization quality, unresolved transfers, manual share, demo cap at `moderate`), each with plain-language reasons and an improvement list.

Reuse: existing `Momentum` index-trend type in `indexing.ts` stays as-is (chart concern); the score overlay is separate and score-derived. `format.ts` gains any shared formatting needed by score UI.

## Data layer

- **`getScoreData(range)`** (new, `src/lib/data`, server-only, RLS-bound): one fetch of accounts + transactions + snapshots + events → `buildMetricInputs` at as-of and range-start dates → `computeScore` × 2 → `computeScoreDelta`, plus `computeScore` at −30d/−60d for the momentum overlay → `computeConfidence`. Returns a single typed payload for `/score`.
- **Dashboard:** `getDashboardData` gains a compact score summary (overall state, band, momentum state, overall confidence, provisional flag) computed via the same engine path.
- No schema changes. Corrections/overrides restate scores automatically on next read (same behavior as snapshots).

## UI

- **Dashboard score card** (mobile-first ~390px): score + band, momentum chip (text + direction glyph, never color-only), confidence chip, provisional label when applicable; links to `/score`. Suppressed state shows "what would unlock your score" instead of a number.
- **`/score` screen:** overall score + band + momentum with its supporting sentence; shared `Segmented` range picker (30D/90D/1Y/All); delta explanation ("what changed") with dimension changes and top metric movers; six dimension rows (score 0–100, confidence, or "Not enough data" + reason); Protection status row (unscored, `not_assessed` copy); expandable per-dimension metric detail with plain-language names, values, and "How is this calculated?" (real formula + curve values from the breakdown); effective-weights disclosure when reweighted; overall-confidence panel with improvement list.
- **States:** loading skeleton, empty (no data → onboarding/demo pointer), error, partial (provisional/suppressed are first-class designed states, not errors). No shame language; positive/negative always paired with sign/shape/text.
- **Report screen relabel** (consumer language): "Free cash flow" → "Monthly surplus", "Owner-created equity" → "Growth you created" (statement semantics unchanged).

## Error handling

Engine functions never throw on missing/empty data — every gap resolves to typed unavailability (`null` metric → ineligible dimension → provisional/suppressed overall) with reasons. Zero-income, single-account, <60-day-history, and debt-free paths are normative spec edge cases with dedicated tests. `getScoreData` propagates query errors to the route's error state; it never fabricates partial breakdowns.

## Testing

- Unit tests per engine module covering the spec's "Test cases" section (weights sum, Protection/Momentum exclusion from weighting, eligibility/renormalization/provisional/suppression, debt-free rule, bonus/irregular income, transfer/reimbursement netting, market-vs-contribution growth separation, high-interest weighting, fixed-cost single-scoring, confidence derivation, version stamping).
- Data-layer mapper tests (offline, mocked rows) for `getScoreData` shapes.
- UI verified live in browser at 390×844 and 1280×900: full, provisional, suppressed, and fresh-user states; console clean. `pnpm check` green before completion.

## Out of scope (v1, recorded)

Protection scoring and its inputs; goal progress (no `financial_goals` table); delinquency/minimum-payment/overdraft indicators; employment-type-aware stability logic; investment-holdings concentration (single-asset/employer-stock/sector/variable-rate); principal-vs-interest splits; persisted score history (revisit at Phase 7); AI narration (Phase 4 — this slice produces its deterministic input).
