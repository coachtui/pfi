# Security Model

Status: core auth + persistence security landed this phase (magic-link auth, schema, RLS, tenant-isolation tests). Real user accounts can exist now, though the only data flowing through the pipeline so far is the demo dataset (seeded through the real path — DECISIONS.md #10). This document states the rules the rest of persistence work (manual entry, CSV import, aggregation) must keep landing with.

## Current state (Phase 0–1)

- Environment variables validated at startup via Zod (`src/lib/config/env.ts`); `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are now **required**, not optional — missing/malformed vars fail loudly. Secrets are never committed (`.env*` gitignored; `.env.example` documents shape only).
- No secrets in client bundles: only `NEXT_PUBLIC_*` values reach the browser.
- **Service-role key confined to `scripts/`.** `SUPABASE_SERVICE_ROLE_KEY` is read only by `scripts/dev-login.ts` and `scripts/test-rls.mts`, both invoked locally via `.env.local` (`tsx --env-file=.env.local`). It is never read by application code under `src/` — server actions and route handlers use the anon-key client (`src/lib/supabase/server.ts`), so every application query is subject to RLS. `getDashboardData` (and all query helpers) must only ever be called with that RLS-bound client, never a service-role client.
- **`supabase config push` syncs the entire `[auth]` section of `supabase/config.toml`, not a diff.** Any auth setting (redirect URLs, providers, site URL) configured only through the dashboard is silently reverted on the next push. All auth configuration must be committed to `supabase/config.toml` — that file is the source of truth.

## Implemented (this phase)

- **Supabase Row-Level Security on every table, default deny.** Migration `0001_core` enables RLS on all six tables (`user_profiles`, `personal_companies`, `financial_accounts`, `transactions`, `financial_events`, `daily_snapshots`) with owner-only `select`/`insert`/`update`/`delete` policies keyed on `auth.uid()`. Migration `0002_integrity` adds a trigger enforcing `transactions.account_id` belongs to `transactions.user_id` (relies on RLS visibility of `financial_accounts` under SECURITY INVOKER — a forged cross-tenant `account_id` is invisible to the check, not just rejected by a redundant `auth.uid()` comparison), plus a trigger that makes transaction source columns immutable after insert (corrections must go through `user_override`; a backfill that must legitimately change a source column has to disable this trigger around the update — see KNOWN_LIMITATIONS).
- **Tenant isolation is automated-tested.** `pnpm test:rls` (`scripts/test-rls.mts`) provisions two real users against the live project and asserts cross-tenant reads/writes/updates/deletes all fail across every table — 9/9 checks passing, run twice with no leaked users left behind, admin cleanup runs regardless of assertion outcome.
- **Auth is magic-link only (PKCE).** No passwords are stored. `/auth/callback` exchanges the PKCE code; the route guard (`src/proxy.ts`) redirects unauthenticated requests to `/login` and authenticated requests away from `/login`. Onboarding gating is a separate mechanism: `src/app/onboarding/page.tsx` redirects already-onboarded users home, and `src/app/page.tsx` redirects not-yet-onboarded users to `/onboarding` (DB-checked in the page components, not in the proxy).

## Rules for Phase 3+ (manual entry, CSV import, aggregation)

- **Server-side authorization on every query.** No financial records exposed through public client queries.
- **Public/private separation.** Public leaderboard and cohort queries read only from aggregated or explicitly public tables — never from raw financial tables. Cohorts below minimum size are suppressed.
- **Masked identifiers only.** Never store full account numbers; provider-safe masked values only.
- **Immutable sources + audited corrections.** Landed for `transactions` (0002's immutability trigger + `user_override`); still needed for other source tables as they gain correction UI. Original imported values are never overwritten; user corrections are stored alongside with an audit trail.
- **Logging:** audit-friendly, with sensitive values (balances, merchants, tokens) redacted. Administrative access is logged. No employee/admin casual browsing of identifiable financial histories.
- **Analytics:** product analytics never receive raw balances, transaction values, or merchant names.
- **AI:** prompts redact sensitive data where possible; strict per-user context isolation.
- **Migrations:** all schema changes through committed migration history.
- **Rate limiting** on write/import endpoints.
- **User control:** account disconnection, full data export, full deletion.
- Data is never sold; individual transaction histories are never used for advertising.

## Threat-model notes to expand in Phase 3

Cross-tenant leakage (RLS bypass), re-identification through cohort aggregates (minimum cohort sizes, suppression, consider differential privacy in Phase 8), CSV import abuse (size limits, parser hardening), and scraping of public profiles.
