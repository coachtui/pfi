# Architecture

## Stack

Next.js (App Router, v16) · TypeScript (strict) · React 19 · Tailwind CSS 4 (CSS-first tokens) · Recharts · Zod · Vitest · pnpm. Supabase planned for auth/Postgres/RLS/storage (Phase 3). Vercel-compatible deployment.

## Structure (single app, package-ready)

```
src/
  app/                    # Next.js routes (home, rankings, data, report)
  components/
    chart/                # FinancialChart (reusable, presentational)
    dashboard/            # HomeDashboard, MetricCard, WhatMovedYourLine, CompanyHeader
    nav/                  # BottomNav
    ui/                   # Card, ComingSoon primitives
  lib/
    config/               # branding (single rename point), env validation
    financial-engine/     # deterministic calculations — framework-free
    demo-data/            # seeded deterministic demo datasets
docs/                     # product + engineering docs (source of truth)
```

Deliberately **not** a monorepo yet (see DECISIONS.md #2). `src/lib/financial-engine` and `src/lib/demo-data` import nothing from React/Next, so they can be lifted into `packages/financial-engine` unchanged when a second consumer (Expo app) appears.

## Layering rules

1. **Calculations never live in components.** Components receive computed values or call pure engine functions; formulas live in `financial-engine` with tests.
2. **The engine is deterministic and typed.** Typed inputs/outputs, documented assumptions, explicit missing-data behavior, metadata for "how is this calculated?" (e.g. `IndexAnchor.method`).
3. **Demo data is isolated from production logic.** `demo-data/` produces the same `DailySnapshot`/`FinancialEvent` types real providers will produce; swapping in real data touches the page loader only.
4. **AI (Phase 4) sits behind a provider-agnostic interface** and consumes structured engine output only (see AI_RECOMMENDATION_POLICY.md).
5. **Branding is centralized** in `lib/config/branding.ts`; nothing else hard-codes the product name.

## Data flow (current)

```
generateKoaHoldings() [seeded, deterministic]
  → DailySnapshot[] + FinancialEvent[]
  → buildIndexSeries / computeDrivers / computeMomentum / computeStatus
  → HomeDashboard (client: range slicing, presentation state only)
  → FinancialChart / MetricCard / WhatMovedYourLine (presentational)
```

Server component (`app/page.tsx`) generates data; the client component owns only view state (selected range). In Phase 3 the page loader swaps demo generation for Supabase queries; everything below is unchanged.

## Rendering & PWA

Mobile-first responsive web app; installable PWA manifest planned in Phase 1 polish. Bottom tab navigation on all viewports for now (recorded as debt in KNOWN_LIMITATIONS.md).

## Testing

Vitest for the engine and demo generator (32 tests). Playwright end-to-end planned once flows exist worth scripting (Phase 1 exit). `pnpm check` = lint + typecheck + test + build.
