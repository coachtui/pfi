# Current Phase

_Last updated: 2026-07-15 (initial implementation session)._

**Phase:** 0 complete → Phase 1 in progress (visual prototype).

## Completed

- Repo initialized: Next.js 16 (App Router, Turbopack), strict TypeScript, Tailwind 4, ESLint, Prettier, Vitest, pnpm.
- Design tokens (`src/app/globals.css`): charcoal/elevated surfaces, emerald/red/amber semantic states, chart palette, radii, shadows. Branding centralized in `src/lib/config/branding.ts`.
- Deterministic financial engine (`src/lib/financial-engine/`): available position, waterline, cushion, robust index (offset anchor + scale floor), rolling baseline, drivers, momentum, status, display formatters. Framework-free, extraction-ready.
- Koa Holdings demo dataset: seeded PRNG, 430 days of daily snapshots + events, improving-liquidity narrative, fully reproducible.
- App shell: bottom tab nav (Home/Rankings/Data/Report), responsive max-width layout.
- Home dashboard: company header, personal index + today change, actual/baseline/waterline chart with event markers and 30D/90D/1Y/All ranges, four metric cards with sparklines, "What moved your line", deterministic performance brief with disclaimer.
- Docs suite: vision, roadmap, architecture, data model, decisions, index methodology, health-score spec, AI policy, security model, known limitations.
- 32 unit tests across engine + demo generator. `pnpm check` (lint, typecheck, test, build) green.

## In progress

- Nothing mid-flight; clean stopping point.

## Next three priorities

1. Rankings screen with deterministic mock cohort data (leaderboard, percentile, challenges).
2. Data/benchmarks screen with mock aggregates (conditions index, cohort comparisons).
3. Onboarding flow + remaining demo profiles (Blue Reef Partners, North Shore Capital) and a demo-profile switcher.

## Known blockers

- None. Supabase credentials will be needed at Phase 3.

## Decisions needed

- Report screen scope for Phase 1 (static mock vs. computed-from-demo-data). Recommendation: computed from demo data, template commentary.
- Whether `% Today` should become index-point change (see KNOWN_LIMITATIONS).

## Test status

`pnpm test`: 32/32 passing. `pnpm lint`, `pnpm typecheck`, `pnpm build`: clean.

## Deployment status

Not deployed. Vercel-compatible; no blockers to a preview deploy.
