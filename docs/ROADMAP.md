# Roadmap

Phases merge the original brief with the strategy addendum (explainable financial health, prioritized actions, scenario modeling before aggregation). Update as work progresses; status lives in CURRENT_PHASE.md.

## Phase 0 — Product foundation ✅ (2026-07-15)

Repo initialized (Next.js 16 / TS strict / Tailwind 4 / Vitest / ESLint / Prettier), design tokens, centralized branding, env validation, docs suite, deterministic demo-data strategy, navigation shell. Supabase wiring deliberately deferred (DECISIONS #3).

## Phase 1 — Visual prototype ✅ (2026-07-17)

- ✅ Home dashboard: company header, personal index, actual/baseline/waterline chart with event markers + 30D/90D/1Y/All, metric cards, "What moved your line", deterministic performance brief
- ✅ Onboarding flow (identity, cohorts, privacy, sample data) — landed with Phase 1.5
- ✅ Rankings screen (mock cohort data)
- ✅ Data/benchmarks screen (mock aggregates)
- ✅ Report screen (shareholder report computed from demo data via the `report.ts` engine, not mock text)
- ✅ Blue Reef Partners + North Shore Capital demo profiles — landed 2026-07-17 with a demo-profile switcher (DECISIONS #17)
- ✅ PWA manifest & installability; Playwright smoke test — landed 2026-07-17 (DECISIONS #22)

Exit: all primary screens responsive; demo user navigates the full experience; components reusable; suitable for product review.

## Phase 1.5 — Infrastructure ✅ (2026-07-15)

Pulled forward ahead of the remaining Phase 1 screens (DECISIONS.md #7): Supabase auth (magic link/PKCE, `/auth/callback`, route guard at `src/proxy.ts`), schema + default-deny RLS (migrations `0001_core`/`0002_integrity`), snapshot builder (backward balance replay + obligation windows), demo generator seeded through the real persistence pipeline, onboarding flow, DB-backed dashboard with loading/empty states, and an automated RLS tenant-isolation test (`pnpm test:rls`).

## Phase 2 — Financial engine ✅ (2026-07-16)

Metric registry behind six weighted dimensions (Cash Flow 25%, Liquidity & Resilience 20%, Debt 20%, Stability 15%, Growth 15%, Concentration 5% — FINANCIAL_HEALTH_SCORE.md is the normative spec); 0–900 versioned score with deterministic score-delta explanations; Protection visible but unscored in v1; Momentum as a directional overlay, not a weighted dimension; per-dimension confidence + deterministic missing-data policy (eligibility, effective-weight renormalization, provisional/suppressed states); consumer-facing terminology (no FCF/owner-created-equity jargon in score UI). Surfaced as a dashboard score card + `/score` breakdown screen. Exit: no displayed metric is hard-coded; everything tested and explainable; partial data handled per the documented policy.

## Phase 3 — Manual data & CSV import ✅ (persistence live; manual CRUD slice landed 2026-07-16; CSV import landed 2026-07-17; recurring detection landed 2026-07-18)

Auth, schema, RLS, tenant isolation, and the snapshot builder landed in Phase 1.5. Manual accounts/transactions CRUD and the correction workflow with audit trail (`transactions.user_override`, per migration 0002's immutability trigger) landed 2026-07-16 (DECISIONS.md #13): a `/transactions` drill-down (filterable list, add/detail sheet, recategorize, manual-only delete) and an `/accounts` management screen (add/edit/include/archive), wired into dashboard drill-down links and a stale-index self-heal. CSV import landed 2026-07-17 (DECISIONS.md #15): client-side parse + server-action trust boundary, framework-free `src/lib/csv-import/` (parse/detect/normalize/dedupe/transfer detection), migration `0004_csv_import` (`transactions.import_batch_id`), a four-step `/import` wizard (upload → map columns → preview → summary with commit/undo), and entry points on `/accounts` (Import CSV + Recent Imports) and the dashboard empty state. Recurring detection landed 2026-07-18 (DECISIONS.md #23), replacing the obligations proxy with recurring-series projection (28-day shift retained as fallback) — Phase 3 complete. Out of v1 scope per the design spec — fuzzy/date-drift dedupe, keyword/merchant categorization, saved per-account mappings, aggregator multi-account files, balance-anchor input at import time. Exit: a user can replace demo data with their own; errors recoverable; data isolated per user.

## Phase 4 — AI financial interpreter (slice 1 of N ✅ 2026-07-18)

- ✅ **Service core + performance-brief narration** — landed 2026-07-18 (DECISIONS #26): provider-agnostic narration service (Vercel AI SDK `generateObject` over AI Gateway model strings, default `anthropic/claude-haiku-4-5`), a strict Zod input/output boundary (`src/lib/ai/schemas.ts`) carrying only derived metrics and type-enum driver references (never raw transactions, labels, or ids), the `ai_narrations` cache/audit table (migration `0009`, owner-only RLS), and the dashboard's existing "Performance brief" card now AI-narrated when a key is configured, falling back to the deterministic brief otherwise (progressive enhancement — the app works identically with no key). Live QA with a real provider key is still pending (KNOWN_LIMITATIONS).
- ⏳ "What moved my line?" AI-narrated driver explanations, weekly brief, recommendation cards (green/yellow/red policy enforced), quarterly shareholder report narration — remaining Phase 4 surfaces, not yet built.

Exit: AI only explains verified metrics; unsafe categories blocked; every recommendation shows evidence and assumptions.

## Phase 5 — Scenario simulator & goals

Goals; deterministic scenario engine (income/expense/debt/savings/purchase/income-loss); projected chart, waterline, runway, goal-date, score impact; highest-impact action engine (detect weakness → candidate actions → code-estimated impact → ranked). Exit: common decisions modelable; AI explains only engine outputs; assumptions visible.

## Phase 6 — Cohorts, rankings & gamification

Anonymized cohorts with minimum sizes + suppression; percentile rankings on normalized improvement metrics (never absolute wealth); challenges, badges, quarterly seasons; opt-in public tickers; anti-gaming + data-coverage requirements. Exit: private data never exposed; opt-out works; manipulation constrained.

## Phase 7 — Account aggregation

Plaid/MX evaluation behind the existing provider abstraction; linking, incremental sync, connection health, reconciliation, webhooks; production security review. Exit: sync failures visible/recoverable; duplicates and transfers tested.

## Phase 8 — Aggregate intelligence

Anonymized benchmark pipeline, household financial-conditions indexes, privacy thresholds, suppression, differential-privacy consideration, documented permitted/prohibited uses. Merchant/geographic trend analytics remain out of scope until value, scale, privacy architecture, legal review, and consent all exist. Exit: no individual reconstructable; consent explicit; outputs auditable; raw data never sold.

## Phase 9 — Production readiness

Accessibility & security audits, performance, monitoring, terms/privacy, fintech legal review, AI-output review, backup/recovery, incident response, closed beta.
