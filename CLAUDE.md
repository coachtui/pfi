# PFI — Personal Finance Index

A personal-finance platform that presents a household's finances like a publicly traded company: indexed performance chart, personal baseline, financial waterline, explainable drivers, cohort benchmarks. Product name is provisional — rename only via `src/lib/config/branding.ts`.

## Start every session here

1. Read `docs/CURRENT_PHASE.md` — current phase, completed work, next three priorities, open decisions.
2. Read `docs/ROADMAP.md` for where the current slice fits (Phase 0 done; Phase 1 visual prototype in progress).
3. Update `docs/CURRENT_PHASE.md` after each meaningful implementation session.

## Workflow

- Use `superpowers:brainstorming` and `superpowers:writing-plans` before implementing any new feature slice; execute plans with review checkpoints.
- Record every significant architecture/product decision in `docs/DECISIONS.md` (date, decision, alternatives, reasoning, consequences). Never make major structural decisions silently.
- Record technical debt in `docs/KNOWN_LIMITATIONS.md` rather than hiding it.
- Run `pnpm check` (lint + typecheck + test + build) before declaring work complete, and visually verify UI changes in a browser at mobile (~390px) and desktop widths.

## Binding product rules

- **Deterministic code calculates; AI only narrates.** No financial formula lives in a React component — all calculations go in `src/lib/financial-engine/` (framework-free, typed, tested). AI (Phase 4) receives structured verified metrics and returns Zod-validated output. See `docs/AI_RECOMMENDATION_POLICY.md`.
- **Never rank users by wealth** — only normalized, behavior-oriented improvement metrics.
- **Below personal baseline ≠ below waterline.** Keep these conditions distinct everywhere.
- **Separate owner-created equity from market appreciation** wherever investment data appears.
- **Privacy by design:** public surfaces show only fictional company identity, indexed values, percentiles, broad bands. See `docs/SECURITY_MODEL.md`.
- **Every score/index must be explainable** ("How is this calculated?" always answerable; score-delta explanations are deterministic, produced before AI narration).
- The health score (0–900, Phase 2) is **not a credit score** and must never be described as one.
- No shame-oriented language; no celebration of extreme austerity.

## Architecture (details in docs/ARCHITECTURE.md)

- Next.js 16 App Router + strict TypeScript + Tailwind 4 (design tokens in `src/app/globals.css` only) + Recharts + Zod + Vitest. pnpm.
- Single app, deliberately not a monorepo yet; `src/lib/financial-engine` and `src/lib/demo-data` must stay free of React/Next imports so they can be extracted to packages later.
- Demo data is seeded and deterministic (`src/lib/demo-data`, fixed seed + fixed end date). Same types as future real providers; swapping data sources touches page loaders only.
- Supabase (auth/Postgres/RLS) arrives in Phase 3 together with its security rules — env vars are validated in `src/lib/config/env.ts` and flip from optional to required then.

## Commands

- `pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build`
- `pnpm check` — all of the above; must be green before completion claims.
