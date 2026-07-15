# Current Phase

_Last updated: 2026-07-15 (infrastructure phase — Task 14, docs + final verification)._

**Phase:** 0 complete, 1.5 (infrastructure) complete → Phase 1 (visual prototype) resumes.

## Completed (this phase — Supabase infrastructure, Tasks 1–14)

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

- Nothing mid-flight; clean stopping point at the end of the infrastructure phase.

## Next three priorities

1. **Rankings screen on mock cohort data** — leaderboard, percentile, challenges (deterministic mock aggregates; real cohort pipeline is Phase 6).
2. **Manual accounts/transactions CRUD** — the first non-demo data path, built on the persistence/RLS layer that now exists (Phase 3 scope, narrowed by DECISIONS.md #7).
3. **Remaining demo profiles + report screen** — Blue Reef Partners, North Shore Capital, and a demo-profile switcher, plus the report screen (mock shareholder report) rounding out Phase 1's screen set.

## Known blockers

- **Production magic-link email flow is unverified.** `admin.generateLink` (used for local dev bootstrap) emits implicit tokens, never a PKCE code, so `scripts/dev-login.ts` can't call the code-only `/auth/callback` directly — it works around this with `verifyOtp`. The real email-click flow through Supabase's default SMTP has not been exercised end-to-end and has no confirmed deliverability (KNOWN_LIMITATIONS).
- None blocking Phase 1 screen work — infrastructure is otherwise usable as-is.

## Decisions needed

- Report screen scope for Phase 1 (static mock vs. computed-from-demo-data). Recommendation: computed from demo data, template commentary.
- Whether `% Today` should become index-point change (see KNOWN_LIMITATIONS).
- Transactional email provider choice before real (non-demo) users onboard.

## Test status

`pnpm check` (lint + typecheck + test + build): green. `pnpm test:rls`: 9/9 passing against the live Supabase project.

## Deployment status

Not deployed. Vercel-compatible; needs `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` set as Vercel env vars before a preview deploy (no other blockers). `supabase/config.toml` auth URLs are localhost-only — any deploy must also add the deployed origin to `site_url`/`additional_redirect_urls` (KNOWN_LIMITATIONS).
