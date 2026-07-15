# Supabase Infrastructure — Design Spec

Date: 2026-07-15 · Status: approved-pending-review · Supersedes DECISIONS.md #3 (Supabase deferral)

## Goal

Move PFI from in-memory demo data onto real rails: Supabase Auth (magic link), a Postgres schema with default-deny RLS for exactly the entities the product reads today, a deterministic snapshot pipeline, onboarding, and demo data seeded through the same path real imports will use. After this phase, every rendered row travels auth → RLS → snapshot pipeline → engine → UI.

## Non-goals (this phase)

CSV import UI, goals, recommendations, cohorts/rankings/benchmarks tables, challenges, health score, AI features, Plaid/aggregators, PWA manifest. Each lands later with its own migration.

## Decisions already made

- Sequencing: infrastructure before more screens or scoring (user decision, this session).
- Auth: **email magic link only** for MVP.
- Demo data: **seeds into the signed-in user's real rows** (`provider='demo'`), deletable in one action. No logged-out demo mode.
- Vertical slice (Approach A): schema covers only what the product reads today; iterate-then-freeze.
- Project: `dgkcmvjfvdlsyuhuewkx` (PFI, East US). CLI linked; `.env.local` holds URL + publishable key.

## 1. Auth & sessions

- `@supabase/ssr` + `@supabase/supabase-js`. Browser client (login form only), server client (all data access), middleware for session refresh + route guarding.
- Routes: `/login` (public) → magic link → callback → `/onboarding` (if `onboarding_completed_at` is null) → `/` (dashboard). All app routes require a session.
- Sign-out control added to the shell.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` become **required** in `env.ts`.

## 2. Schema — migration `0001_core`

Committed under `supabase/migrations/`, pushed with the CLI. Tables (all with `created_at timestamptz default now()`):

- **user_profiles** — `id uuid PK references auth.users`, `username text unique not null`, `age_cohort`, `income_band`, `household_type`, `col_cohort`, `objective`, `privacy_settings jsonb not null default '{}'`, `onboarding_completed_at timestamptz`.
- **personal_companies** — `id uuid PK`, `user_id uuid unique not null → user_profiles`, `name text not null`, `ticker text not null`, `logo_path text`, `public_profile_enabled boolean not null default false`, `data_coverage_state text not null default 'demo'`.
- **financial_accounts** — `id uuid PK`, `user_id`, `provider text not null check in ('demo','manual','csv')`, `institution text`, `type text not null` (checking, savings, money_market, credit_card, mortgage, auto_loan, student_loan, personal_loan, brokerage, retirement, property, other_asset, other_liability), `subtype text`, `display_name text not null`, `mask text`, `currency text not null default 'USD'`, `current_balance numeric(14,2)`, `available_balance numeric(14,2)`, `credit_limit numeric(14,2)`, `interest_rate numeric(6,4)`, `include_in_calculations boolean not null default true`, `include_in_public_score boolean not null default false`, `connection_status text not null default 'ok'`, `last_synced_at timestamptz`.
- **transactions** — `id uuid PK`, `account_id → financial_accounts`, `user_id`, `posted_date date not null`, `authorized_date date`, `amount numeric(14,2) not null` (positive; sign carried by `direction`), `direction text not null check in ('inflow','outflow')`, `description text not null`, `category text`, `subcategory text`, `txn_type text`, `recurring_status text`, `essential boolean`, `is_transfer boolean not null default false`, `transfer_pair_id uuid`, `confidence numeric(3,2)`, `user_override jsonb`, `notes text`. Source columns are never updated after insert; corrections go in `user_override` (audit trail preserved).
- **financial_events** — `id uuid PK`, `user_id`, `date date not null`, `type text not null` (paycheck, bonus, mortgage_payment, large_purchase, insurance_payment, investment_contribution, debt_payment, debt_payoff, tax_payment, unexpected_expense), `label text not null`, `amount numeric(14,2) not null`, `direction text not null`.
- **daily_snapshots** — PK (`user_id`, `date`); `liquid_assets`, `revolving_balances`, `near_term_obligations`, `essential_obligations`, `safety_buffer`, `net_worth` (all numeric(14,2)); `engine_version text not null`; `data_coverage_confidence text not null default 'demo'`. Derived values (index, baseline, waterline) are computed by the engine at read time from these fields — storing raw components, not indexed values, keeps restatements free (recompute, don't migrate).

**RLS:** `enable row level security` on all six tables; one owner policy per verb per table (`using / with check auth.uid() = user_id`; for `user_profiles`, `auth.uid() = id`). No anon policies — default deny is the whole story until public profiles are designed.

**Indexes:** `transactions (user_id, posted_date)`, `daily_snapshots (user_id, date)`, `financial_events (user_id, date)`, `financial_accounts (user_id)`.

## 3. Snapshot pipeline

New engine module `src/lib/financial-engine/snapshot-builder.ts`:

```
buildDailySnapshots(accounts, transactions, config: { safetyBuffer, endDate })
  → DailySnapshot[]
```

Pure and deterministic: replays transactions chronologically from account opening balances; derives liquid assets, revolving balances, near-term/essential obligations (from recurring outflows before the next detected income event); stamps `ENGINE_VERSION`. Unit-tested like the rest of the engine. A server action `rebuildSnapshots(userId)` runs it and idempotently replaces that user's snapshot rows (delete + insert in a transaction). Triggered after seeding (and after any future import).

## 4. Demo seeding

`generateKoaHoldings()` is refactored to emit **accounts + transactions + events** instead of pre-built snapshots (same seed, same PRNG, same narrative). The existing direct-snapshot output remains only as a test fixture to validate the snapshot builder produces equivalent results. Server action `loadDemoData()`: inserts demo rows (`provider='demo'`) → `rebuildSnapshots()`. `clearDemoData()`: deletes demo-provider rows + rebuilds. Both are owner-scoped through RLS.

## 5. Onboarding

Route `/onboarding`, multi-step (React Hook Form + Zod, mobile-first): company name → ticker → username → age cohort → income band → household type → cost-of-living → primary objective → privacy defaults (public profile **off**) → "Load demo data or start empty". Writes profile + company, stamps `onboarding_completed_at`, redirects to dashboard.

## 6. App changes

- `app/page.tsx`: server component fetches profile, company, snapshots, events; passes to the unchanged `HomeDashboard`.
- New states (mobile-first at ~390px): loading skeleton for the dashboard, empty state with load-demo CTA, error state. Partial-data behavior unchanged (engine already handles it).
- Rankings/Data/Report stubs remain.

## 7. Testing

- Engine tests unchanged; new snapshot-builder tests: determinism, equivalence to the legacy generator fixture, transfers not double-counted, missing-history behavior.
- **Tenant-isolation test** (`scripts/test-rls.ts`): against local Supabase (`supabase start`, Docker) or a disposable remote branch — two users, each seeded; assert cross-user select/insert/update/delete all fail through the anon-key client. This automates SECURITY_MODEL.md's core promise.
- `pnpm check` stays green; manual browser verification at mobile + desktop.

## 8. Security notes

Publishable key only in the browser; `SUPABASE_ACCESS_TOKEN`/service keys never in the repo or client (service-role usage limited to the RLS test script via env). Masked account identifiers only. Migration history committed. Logs must not contain balances or tokens.

## 9. Risks / open items

- Near-term-obligation derivation from raw transactions (vs. the demo generator's schedule knowledge) is the hardest part of the snapshot builder; first version uses detected recurring outflows + essential daily run-rate, documented in FINANCIAL_INDEX_METHODOLOGY.md when it lands.
- Magic-link email deliverability on Supabase's default SMTP is fine for dev; custom SMTP is a Phase 9 concern.
- Docker availability for local Supabase is unverified on this machine; fallback is a disposable remote schema for the RLS test.
