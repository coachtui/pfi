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
- The health score (0–900, Phase 2) is **not a credit score** and must never be described as one. Scores are versioned; methodology changes never silently rewrite history. Material data gaps lower displayed **confidence**, never silently the score.
- **Prioritized actions, not advice lists.** The default experience answers: what is the single most useful financial action I can take next? No generic advice ("spend less", "make a budget").
- No shame-oriented language; no celebration of extreme austerity.
- **Analytics privacy:** product analytics never receive raw balances, transaction values, or merchant names.

## UX requirements

- **Mobile-first, always.** Design and verify at ~390px before desktop; desktop adapts from the mobile layout, not the reverse. Ship as an installable PWA (manifest pending — see KNOWN_LIMITATIONS).
- Accessible: keyboard navigable, screen-reader labels, sufficient contrast, and **never communicate positive/negative state through color alone** (pair with shape, sign, or text).
- Every screen handles loading, empty, error, and partial-data states; dashboards get skeletons.
- Every metric/score offers "How is this calculated?"; every recommendation offers "Why am I seeing this?".

## Architecture (details in docs/ARCHITECTURE.md)

- Next.js 16 App Router + strict TypeScript + Tailwind 4 (design tokens in `src/app/globals.css` only) + Recharts + Zod + Vitest. pnpm.
- Single app, deliberately not a monorepo yet; `src/lib/financial-engine` and `src/lib/demo-data` must stay free of React/Next imports so they can be extracted to packages later.
- Demo data is seeded and deterministic (`src/lib/demo-data`, fixed seed + fixed end date). Same types as future real providers; swapping data sources touches page loaders only.
- Supabase (auth/Postgres/RLS) landed ahead of schedule as Phase 1.5 infrastructure (see docs/DECISIONS.md #7) — env vars are validated in `src/lib/config/env.ts` and are now required, not optional.

## Commands

- `pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build`
- `pnpm check` — all of the above; must be green before completion claims.
