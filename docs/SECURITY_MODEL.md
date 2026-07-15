# Security Model

Status: Phase 0 groundwork. No real user data exists yet (deterministic demo data only, no auth, no persistence). This document states the rules the first persistence work must land with — security arrives **with** the data, not after it.

## Current state (Phase 0–1)

- No live financial data, no credentials, no PII anywhere in the repo.
- Environment variables validated at startup via Zod (`src/lib/config/env.ts`); missing/malformed vars fail loudly. Secrets are never committed (`.env*` gitignored; `.env.example` documents shape only).
- No secrets in client bundles: only `NEXT_PUBLIC_*` values reach the browser.

## Rules for Phase 3+ (first real data)

- **Supabase Row-Level Security on every table, default deny.** Strict tenant isolation: every row carries `user_id`; every policy checks `auth.uid()`. Tenant isolation gets automated tests.
- **Server-side authorization on every query.** No financial records exposed through public client queries.
- **Public/private separation.** Public leaderboard and cohort queries read only from aggregated or explicitly public tables — never from raw financial tables. Cohorts below minimum size are suppressed.
- **Masked identifiers only.** Never store full account numbers; provider-safe masked values only.
- **Immutable sources + audited corrections.** Original imported values are never overwritten; user corrections are stored alongside with an audit trail.
- **Logging:** audit-friendly, with sensitive values (balances, merchants, tokens) redacted. Administrative access is logged. No employee/admin casual browsing of identifiable financial histories.
- **Analytics:** product analytics never receive raw balances, transaction values, or merchant names.
- **AI:** prompts redact sensitive data where possible; strict per-user context isolation.
- **Migrations:** all schema changes through committed migration history.
- **Rate limiting** on write/import endpoints.
- **User control:** account disconnection, full data export, full deletion.
- Data is never sold; individual transaction histories are never used for advertising.

## Threat-model notes to expand in Phase 3

Cross-tenant leakage (RLS bypass), re-identification through cohort aggregates (minimum cohort sizes, suppression, consider differential privacy in Phase 8), CSV import abuse (size limits, parser hardening), and scraping of public profiles.
