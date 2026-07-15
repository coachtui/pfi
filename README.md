# PFI — Personal Finance Index

A personal-finance platform that makes a household's finances feel like managing a publicly traded company: an indexed performance chart, a personal baseline, a financial waterline, and clear explanations of what moved your line.

> Product name is provisional. It is configured once in `src/lib/config/branding.ts` — rename there only.

## Status

Phase 1 (visual prototype). The app runs entirely on deterministic demo data — no auth, no persistence, no real financial data yet. See `docs/CURRENT_PHASE.md`.

## Getting started

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | Production build |
| `pnpm check` | lint + typecheck + test + build |

## Architecture in one paragraph

Deterministic financial calculations live in `src/lib/financial-engine` (framework-free, typed, tested — extractable to a shared package later). Seeded demo datasets live in `src/lib/demo-data`. React components are presentational and never contain financial formulas. AI (Phase 4) will narrate engine output, never calculate. Full details: `docs/ARCHITECTURE.md`.

## Documentation

Everything important lives in `docs/`: PRODUCT_VISION, ROADMAP, CURRENT_PHASE (session status), ARCHITECTURE, DATA_MODEL, DECISIONS (ADR log), FINANCIAL_INDEX_METHODOLOGY, FINANCIAL_HEALTH_SCORE, AI_RECOMMENDATION_POLICY, SECURITY_MODEL, KNOWN_LIMITATIONS.

## Disclaimers

PFI is an analytics, education, and decision-support tool. It is not accounting, legal, tax, or investment advice; the financial-health score is not a credit score.
