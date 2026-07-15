# Architecture & Product Decisions

Format: date, decision, context, alternatives, reasoning, consequences. Do not make major structural decisions without recording them here.

---

## 1. 2026-07-15 — Offset-based index instead of naive ratio

**Decision:** `index(v) = 100 + 100 × (v − A) / S` with a median anchor and a floored scale (see FINANCIAL_INDEX_METHODOLOGY.md).
**Alternatives:** naive `current/start × 100`; log-scaled index; percentile-based index.
**Reasoning:** naive ratio explodes for negative/near-zero starts; log scale can't handle negatives and is hard to explain; percentiles need cohort data we don't have yet. The offset form degrades exactly to the naive formula in the healthy case and is explainable in one sentence.
**Consequences:** index points are "percent of starting scale", not strictly "percent growth" for users with unusual anchors; anchor method must be surfaced in the UI.

## 2. 2026-07-15 — Single Next.js app, not a monorepo

**Decision:** one app with `src/lib/financial-engine` kept framework-free.
**Alternatives:** pnpm workspace monorepo (`apps/web`, `packages/financial-engine`, …).
**Reasoning:** one consumer today; monorepo plumbing adds cost with no benefit yet. The brief explicitly allows this. Extraction path is preserved by the no-React-imports rule in `lib/financial-engine` and `lib/demo-data`.
**Consequences:** revisit when the Expo app or a second package consumer starts.

## 3. 2026-07-15 — Supabase wiring deferred to Phase 3

**Decision:** env validation scaffolding now (`lib/config/env.ts`, optional Supabase vars); live auth/persistence when real user data arrives.
**Alternatives:** wire Supabase in Phase 0 per the original roadmap.
**Reasoning:** Phases 0–1 run entirely on deterministic demo data; auth against nothing adds surface without value, and no credentials exist in this environment. Security rules for the first persistence work are pre-committed in SECURITY_MODEL.md.
**Consequences:** Phase 3 must land schema + RLS + auth together; env vars flip from `.optional()` to required then.

## 4. 2026-07-15 — Chart data indexed once over full history; ranges are views

**Decision:** anchor derived from full history; 30D/90D/1Y/All only slice the rendered window.
**Alternatives:** re-anchor per range (each range starts at 100).
**Reasoning:** re-anchoring makes the same day show different values in different ranges — confusing and hides long-term drift. One anchor keeps "118.4" meaning one thing.
**Consequences:** short ranges may render far from 100; Y axis auto-zooms to data.

## 5. 2026-07-15 — Honest cash impact in engine, equity-aware display

**Decision:** `Driver.impact` is always the true cash impact; `driverDisplay()` presents investment contributions and full debt payoffs as equity-positive (emerald, "+") so saving is never framed as loss. Routine debt payments display as outflows.
**Alternatives:** flip signs in the engine; show everything as raw cash flow.
**Reasoning:** engine stays truthful for calculations and future AI input; display layer carries the owner-created-equity product principle (mockups show "Investment +$500" in green).
**Consequences:** display semantics live in one tested function (`driverDisplay`); AI narration must use the same semantics.

## 6. 2026-07-15 — Demo "today" is a fixed date

**Decision:** Koa Holdings history ends at a hard-coded 2026-07-15 with a fixed PRNG seed.
**Alternatives:** generate relative to the real current date.
**Reasoning:** full determinism — identical charts in tests, screenshots, reviews; no snapshot drift between runs.
**Consequences:** the demo dashboard always shows the same "today"; acceptable until real data phases.
