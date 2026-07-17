# Current Phase

_Last updated: 2026-07-16 (PFI score v1 slice)._

**Phase:** 0 complete, 1.5 (infrastructure) complete, visual-parity slice (Home polish, Rankings, Data) complete, report screen complete, transactions/accounts CRUD slice complete → Phase 2's PFI score v1 (metric registry, curves, six weighted dimensions, confidence, momentum overlay, `/score` screen, dashboard score card) has now landed, ahead of full Phase 1 completion (CSV import remains, see ROADMAP.md Phase 3). Task 11 (final `pnpm check` + live browser QA of `/score`) is still outstanding for this slice.

## Completed (this phase — PFI score v1, Tasks 1–10)

- **Score types + metric-inputs bundle.** `src/lib/financial-engine/score-types.ts` and the `MetricInputs` assembly step feeding the scoring pipeline from existing snapshot/transaction/event data — no new persistence, framework-free.
- **Metric registry.** 17 scored metrics across six dimensions (Cash Flow, Debt, Savings, Stability, Growth, Emergency Fund per FINANCIAL_HEALTH_SCORE.md v1.0) with eligibility guards; Protection is intentionally unscored.
- **Scoring engine.** Per-metric curve scoring, six weighted dimensions, eligibility-driven renormalization when a dimension can't be scored — no financial formula lives outside the engine.
- **Deterministic per-dimension confidence.** Confidence is computed, not asserted; material data gaps lower confidence, never silently the score.
- **Momentum overlay.** `computeScoreMomentum` (renamed from an earlier collision with `insights.ts`) — a directional state machine (improving/steady/declining) with threshold-boundary and null-position test coverage.
- **Score-delta explanations.** Deterministic, produced before any AI narration (Phase 4), with a full-pipeline test proving the whole chain (metric inputs → registry → scoring → confidence → momentum → delta) end to end.
- **Data layer.** `getScoreData`/`getScoreSummary` in `src/lib/data/queries.ts` — read-time score assembly from real (demo) persistence; `getDashboardData` now runs `getScoreSummary` alongside its existing dashboard queries via `Promise.all` (see KNOWN_LIMITATIONS — a batching opportunity, not a defect).
- **`/score` screen.** Overall score/band, momentum chip (glyph + text, never color alone), confidence chip, provisional/suppressed states with visible tags and no fabricated numbers, range-scoped delta (from→to, per-dimension signed changes, top movers), six expandable dimension rows with "How is this calculated?" metric detail, a separate clearly-unscored Protection row, and an overall-confidence panel. Never describes the score as a credit score.
- **Dashboard PFI score card.** `src/components/dashboard/ScoreCard.tsx` links to `/score`; suppressed/provisional/full states handled with the same no-fabrication rule as the score screen.
- **Consumer-language relabel.** `/report`'s statement rows now read "Monthly surplus" (was "Free cash flow") and "Growth you created" (was "Owner-created equity") — labels only; engine identifiers (`freeCashFlow`, `ownerCreatedEquity`) unchanged.
- **Test coverage.** Engine suite: 14 test files / 122 tests (score-types through score-pipeline). Full suite: 21 test files / 169 tests, all green.
- **Not yet done in this slice:** Task 11's final `pnpm check` + live browser QA of `/score` (dashboard card + range switching + expand/collapse) at 390×844 and 1280×900 — verification is in progress, not yet claimed complete.

## Completed (previous phase — transactions/accounts CRUD slice, Tasks 1–14)

- **Migration `0003_manual_data`.** `financial_accounts.archived_at timestamptz` — accounts are archived, never deleted, so past snapshots built from an archived account's history stay valid.
- **Engine additions.** `src/lib/financial-engine/overrides.ts` (`parseOverride`/`applyOverride`, defensive `user_override` jsonb parsing, `CorrectableTransaction`/`EffectiveTransaction`) and `rebuild.ts` (`deriveRebuildConfig`, pure) — both framework-free and tested, no React/Next imports.
- **Category/validation config.** `src/lib/config/categories.ts` (`CATEGORIES`/`CATEGORY_LABELS`) and `src/lib/validation/transactions.ts` (Zod schemas, `TransactionFilters`, `parseTransactionFilters`, `MutationResult`, `ACCOUNT_TYPES`).
- **Mappers + queries.** `TransactionListRow→TransactionListItem` and `AccountRow→AccountSummary` mappers; `getTransactionsData`, `getAccountsData`; a `staleIndex` flag on `getDashboardData`; override-aware effective categories in `getReportData`.
- **Shared snapshot-rebuild pipeline.** `insertChunked` extracted from the demo generator into `src/lib/data/insert-chunked.ts`; `rebuildSnapshots(supabase)` (fetch → derive config → `buildDailySnapshots` → replace rows) and `finishWithRebuild(supabase)` (shared rebuild + revalidate tail) used by every balance-affecting server action, including demo seed/clear, so manual accounts survive demo reseeds.
- **Server actions.** `src/app/actions/transactions.ts` (`createTransaction`, `deleteTransaction`, `overrideTransaction`) and `src/app/actions/accounts.ts` (`createAccount`, `updateAccount`, `setAccountIncluded`, `setAccountArchived`) — all return `{ error }`/`""` on success behind RLS-bound queries.
- **`/transactions` drill-down.** Filterable list (account/category/direction, month-grouped, client-side), a manual-only add sheet, a detail sheet supporting recategorize/description/notes corrections (with a visible "corrected" indicator and reset-to-original) and manual-only delete (two-step in-app confirm, no native `window.confirm`). Imported (demo) transactions show the correction UI but no delete action.
- **`/accounts` management screen.** Grouped by account type; add/edit (manual accounts only), include/exclude toggle, and archive/unarchive for every account, each with visible explanatory copy (no color-only signaling).
- **Dashboard drill-down wiring.** "Available Capital" metric card links to `/accounts`; "What moved your line" driver rows link to `/transactions` pre-filtered by date/label with a context banner ("tapped from …"); a stale-index self-heal triggers a rebuild on home-page load when `staleIndex` is set.
- **RLS isolation extension.** `scripts/test-rls.mts` grew from 9 to 15 checks: manual-account transaction insert, frozen-source-column immutability, own/foreign `user_override` writes, cross-user override/delete/archive denial — 15/15 passing live against the real Supabase project.
- **Live browser QA.** `/`, `/transactions`, `/accounts` verified in a real headless browser (gstack `browse`) at 390×844 and 1280×900 against a fresh onboarded user with demo data loaded: onboarding → dashboard, driver-row and Available Capital drill-down links, recategorize with "corrected" badge, add/delete a manual transaction (delete only offered on manual rows, two-step confirm), add/edit/exclude/archive a manual and a demo account (index numbers visibly recomputed after exclude), and the "no transactions match" empty-filter state — console clean on all three routes throughout. Loading skeletons and a genuine error boundary were not forced (no reliable local way to inject a query failure or throttle this session); everything else in the brief's checklist was exercised live, not just read from source.

## Completed (previous phase — report screen, Tasks 1–6)

- **Report data + mapper.** `getReportData` query and a transaction mapper feed the report engine from the real (demo) persistence pipeline.
- **`report.ts` engine module.** Period enumeration (Monthly/Quarterly), a reconciling period statement (`computePeriodStatement`), and deterministic management commentary — no AI, no hard-coded numbers.
- **`/report` screen.** Monthly/Quarterly toggle, period index chart, reconciling statement, and commentary, replacing the prior stub.
- **Live-verified reconciliation.** The `FCF === owner-created equity` identity holds across real periods, including a negative-savings edge case.

## Completed (previous phase — visual parity, Tasks 1–11)

- **Reusable UI extracted.** `Sparkline`, `Segmented`, `PercentileBar`, `TrendStatCard`, and pure positioning helpers (`railPositions`, `markerXFraction` in `src/lib/ui/math.ts`) pulled out of one-off usages for reuse across Home/Rankings/Data.
- **Chart polish.** Inline actual/baseline/waterline line labels replace the old legend; labeled event stems (paycheck/mortgage/bonus) render beneath the chart on ranges ≤45 days; demo chart texture tuned to look less perfectly smooth.
- **Home dashboard polish.** Momentum bars glyph and level avatar chip added to the company header.
- **Rankings screen** (`/rankings`): league tabs (Age/Income/Region/Overall), own-company summary card, leaderboard with rank movement and a highlighted own row, quarterly challenges — all on deterministic sample cohort data (`src/lib/demo-data/cohorts.ts`).
- **Data screen** (`/data`): household financial-conditions index + chart, cohort filter chips, four benchmark metric cards, percentile "how you compare" bars, cohort trend cards — same sample cohort data module.
- **Full verification.** `pnpm check` green; Home/Rankings/Data checked live at 390×844 and 1280×900 against mockup references, console clean on all three routes (details: `.superpowers/sdd/vp-task-11-report.md`).

## Completed (earlier phase — Supabase infrastructure, Tasks 1–14)

- **Env + deps.** `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are required (not optional) in `src/lib/config/env.ts`; Supabase JS/SSR deps added.
- **Schema + RLS.** Migration `0001_core`: six tables (`user_profiles`, `personal_companies`, `financial_accounts`, `transactions`, `financial_events`, `daily_snapshots`), default-deny RLS with owner-only policies on every table. Migration `0002_integrity`: transaction source-immutability trigger, account-ownership trigger, data-quality checks, an index.
- **Auth.** Magic-link (PKCE) via Supabase; `/auth/callback` route; `src/proxy.ts` route guard (Next 16 renamed `middleware` → `proxy`). All auth settings live in `supabase/config.toml` (`supabase config push` syncs the whole `[auth]` section — dashboard-only changes get reverted).
- **Snapshot builder.** `src/lib/financial-engine/snapshot-builder.ts`: backward balance replay from current balances + transactions, and obligation-window derivation (income-date detection, 28-day previous-cycle proxy). See FINANCIAL_INDEX_METHODOLOGY.md "Snapshot derivation (v1)".
- **Demo pipeline.** Demo generator refactored to emit accounts + transactions (not just snapshots); `loadDemoData`/`clearDemoData` server actions seed/clear through the real insert → snapshot-build → RLS-read path (DECISIONS.md #10).
- **Onboarding.** Identity/cohort/privacy form → company + profile creation, idempotent on retry.
- **Dashboard on real data.** `getDashboardData` (RLS-bound client only) replaces the static demo import; loading and empty states added.
- **RLS tenant-isolation test.** `pnpm test:rls` (`scripts/test-rls.mts`) — 9/9 checks passing live, twice, no leaked users.
- **Docs.** DECISIONS #7–11, DATA_MODEL implemented-table status, SECURITY_MODEL implemented section, FINANCIAL_INDEX_METHODOLOGY snapshot-derivation section, KNOWN_LIMITATIONS infrastructure entries, ROADMAP Phase 1.5, README status/scripts, this file.

## In progress

- **Task 11 of the PFI score v1 slice** — final `pnpm check` and live browser QA of `/score` (dashboard score card, range switching, dimension/metric expand-collapse) at 390×844 and 1280×900. Not yet run; CURRENT_PHASE test counts below reflect `pnpm test` only.

## Next three priorities

1. **CSV import** — column mapping, preview, dedupe, transfer detection, import summary (Phase 3 remainder; see ROADMAP.md Phase 3).
2. **Remaining demo profiles + demo-profile switcher** — Blue Reef Partners, North Shore Capital.
3. **PWA manifest + Playwright smoke test** — installability and automated browser verification.

## Known blockers

- **Production magic-link email flow is unverified.** `admin.generateLink` (used for local dev bootstrap) emits implicit tokens, never a PKCE code, so `scripts/dev-login.ts` can't call the code-only `/auth/callback` directly — it works around this with `verifyOtp`. The real email-click flow through Supabase's default SMTP has not been exercised end-to-end and has no confirmed deliverability (KNOWN_LIMITATIONS).
- None blocking Phase 1 screen work — infrastructure is otherwise usable as-is.

## Decisions needed

- Whether `% Today` should become index-point change (see KNOWN_LIMITATIONS).
- Transactional email provider choice before real (non-demo) users onboard.

## Test status

`pnpm test`: green, 169 tests passing (21 test files; engine subset alone is 14 files / 122 tests). `pnpm check` (lint + typecheck + test + build) for this slice has not yet been run end-to-end — that's Task 11. `pnpm test:rls`: 15/15 passing against the live Supabase project (unchanged this slice, no schema/RLS changes).

## Deployment status

Not deployed. Vercel-compatible; needs `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` set as Vercel env vars before a preview deploy (no other blockers). `supabase/config.toml` auth URLs are localhost-only — any deploy must also add the deployed origin to `site_url`/`additional_redirect_urls` (KNOWN_LIMITATIONS).
