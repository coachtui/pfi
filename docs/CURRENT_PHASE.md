# Current Phase

_Last updated: 2026-07-15 (report-screen slice — Task 6, docs + final verification)._

**Phase:** 0 complete, 1.5 (infrastructure) complete, visual-parity slice (Home polish, Rankings, Data) complete, report screen complete → Phase 1 (visual prototype) continues.

## Completed (this phase — report screen, Tasks 1–6)

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

- Nothing mid-flight; clean stopping point at the end of the report-screen slice.

## Next three priorities

1. **Manual accounts/transactions CRUD** — the transactions drill-down per DECISIONS.md #12, the first non-demo data path, built on the persistence/RLS layer that now exists (Phase 3 scope).
2. **Remaining demo profiles + demo-profile switcher** — Blue Reef Partners, North Shore Capital.
3. **PWA manifest + Playwright smoke test** — installability and automated browser verification.

## Known blockers

- **Production magic-link email flow is unverified.** `admin.generateLink` (used for local dev bootstrap) emits implicit tokens, never a PKCE code, so `scripts/dev-login.ts` can't call the code-only `/auth/callback` directly — it works around this with `verifyOtp`. The real email-click flow through Supabase's default SMTP has not been exercised end-to-end and has no confirmed deliverability (KNOWN_LIMITATIONS).
- None blocking Phase 1 screen work — infrastructure is otherwise usable as-is.

## Decisions needed

- Whether `% Today` should become index-point change (see KNOWN_LIMITATIONS).
- Transactional email provider choice before real (non-demo) users onboard.

## Test status

`pnpm check` (lint + typecheck + test + build): green, 94 tests passing (11 test files). `pnpm test:rls`: 9/9 passing against the live Supabase project.

## Deployment status

Not deployed. Vercel-compatible; needs `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` set as Vercel env vars before a preview deploy (no other blockers). `supabase/config.toml` auth URLs are localhost-only — any deploy must also add the deployed origin to `site_url`/`additional_redirect_urls` (KNOWN_LIMITATIONS).
