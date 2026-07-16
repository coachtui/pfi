# PFI — Personal Finance Index

A personal-finance platform that makes a household's finances feel like managing a publicly traded company: an indexed performance chart, a personal baseline, a financial waterline, and clear explanations of what moved your line.

> Product name is provisional. It is configured once in `src/lib/config/branding.ts` — rename there only.

## Status

Phase 1 (visual prototype) + Phase 1.5 infrastructure are complete, and the first slice of Phase 3 has landed: a `/transactions` drill-down (filterable list, manual add/recategorize/delete) and an `/accounts` management screen (add/edit/include/archive), wired from the dashboard. Auth (Supabase magic link) and the database (Postgres + RLS) are live; the app persists data through the real pipeline. Seeded Koa Holdings demo data and real manual entries can now coexist — CSV import is still ahead. See `docs/CURRENT_PHASE.md` for the latest session-by-session status.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev          # http://localhost:3000
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to run the app (validated at startup, `src/lib/config/env.ts`). `pnpm test:rls` additionally needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` — never used by application code, only by the RLS test script and local dev-login bootstrap under `scripts/`.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:rls` | Live Supabase RLS tenant-isolation check (needs `SUPABASE_SERVICE_ROLE_KEY`) |
| `pnpm test:live` | Live Supabase server-action tests (same credentials; kept out of `pnpm test`/`pnpm check` so the default suite stays fast and offline) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | Production build |
| `pnpm check` | lint + typecheck + test + build |

## Architecture in one paragraph

Deterministic financial calculations live in `src/lib/financial-engine` (framework-free, typed, tested — extractable to a shared package later). Seeded demo datasets live in `src/lib/demo-data`. React components are presentational and never contain financial formulas. AI (Phase 4) will narrate engine output, never calculate. Full details: `docs/ARCHITECTURE.md`.

## Roadmap

Full detail (exit criteria, alternatives considered) lives in `docs/ROADMAP.md`; this is the condensed version.

| Phase | Focus | Status |
|---|---|---|
| 0 | Product foundation — repo, tokens, branding, demo-data strategy | ✅ Done |
| 1 | Visual prototype — dashboard, rankings, data, report screens | 🔨 In progress (screens above ✅; onboarding polish, second demo profile, PWA/installability remain) |
| 1.5 | Infrastructure — Supabase auth/RLS, snapshot builder, tenant-isolation tests | ✅ Done (pulled forward ahead of schedule) |
| 2 | Financial engine — full metric registry, 0–900 health score, confidence model | ⬜ Not started |
| 3 | Manual data & CSV import | 🔨 In progress (manual accounts/transactions CRUD + correction workflow ✅; CSV import, recurring detection remain) |
| 4 | AI financial interpreter — narrates verified metrics, never calculates | ⬜ Not started |
| 5 | Scenario simulator & goals | ⬜ Not started |
| 6 | Cohorts, rankings & gamification | ⬜ Not started |
| 7 | Account aggregation (Plaid/MX) | ⬜ Not started |
| 8 | Aggregate intelligence — anonymized benchmarks | ⬜ Not started |
| 9 | Production readiness — audits, legal review, closed beta | ⬜ Not started |

## Documentation

Everything important lives in `docs/`: PRODUCT_VISION, ROADMAP, CURRENT_PHASE (session status), ARCHITECTURE, DATA_MODEL, DECISIONS (ADR log), FINANCIAL_INDEX_METHODOLOGY, FINANCIAL_HEALTH_SCORE, AI_RECOMMENDATION_POLICY, SECURITY_MODEL, KNOWN_LIMITATIONS.

## Disclaimers

PFI is an analytics, education, and decision-support tool. It is not accounting, legal, tax, or investment advice; the financial-health score is not a credit score.
