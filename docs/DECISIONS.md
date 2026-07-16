# Architecture & Product Decisions

Format: date, decision, context, alternatives, reasoning, consequences. Do not make major structural decisions without recording them here.

---

## 1. 2026-07-15 — Offset-based index instead of naive ratio

**Decision:** `index(v) = 100 + 100 × (v − A) / S` with a median anchor and a floored scale (see FINANCIAL_INDEX_METHODOLOGY.md).
**Alternatives:** naive `current/start × 100`; log-scaled index; percentile-based index.
**Reasoning:** naive ratio explodes for negative/near-zero starts; log scale can't handle negatives and is hard to explain; percentiles need cohort data we don't have yet. The offset form degrades exactly to the naive formula in the healthy case and is explainable in one sentence.
**Consequences:** index points are "percent of starting scale", not strictly "percent growth" for users with unusual anchors; anchor method must be surfaced in the UI.

## 2. 2026-07-15 — Single Next.js app, not a monorepo

**Decision:** one app with `src/lib/financial-engine` kept framework-free.
**Alternatives:** pnpm workspace monorepo (`apps/web`, `packages/financial-engine`, …).
**Reasoning:** one consumer today; monorepo plumbing adds cost with no benefit yet. The brief explicitly allows this. Extraction path is preserved by the no-React-imports rule in `lib/financial-engine` and `lib/demo-data`.
**Consequences:** revisit when the Expo app or a second package consumer starts.

## 3. 2026-07-15 — Supabase wiring deferred to Phase 3

**Decision:** env validation scaffolding now (`lib/config/env.ts`, optional Supabase vars); live auth/persistence when real user data arrives.
**Alternatives:** wire Supabase in Phase 0 per the original roadmap.
**Reasoning:** Phases 0–1 run entirely on deterministic demo data; auth against nothing adds surface without value, and no credentials exist in this environment. Security rules for the first persistence work are pre-committed in SECURITY_MODEL.md.
**Consequences:** Phase 3 must land schema + RLS + auth together; env vars flip from `.optional()` to required then.

## 4. 2026-07-15 — Chart data indexed once over full history; ranges are views

**Decision:** anchor derived from full history; 30D/90D/1Y/All only slice the rendered window.
**Alternatives:** re-anchor per range (each range starts at 100).
**Reasoning:** re-anchoring makes the same day show different values in different ranges — confusing and hides long-term drift. One anchor keeps "118.4" meaning one thing.
**Consequences:** short ranges may render far from 100; Y axis auto-zooms to data.

## 5. 2026-07-15 — Honest cash impact in engine, equity-aware display

**Decision:** `Driver.impact` is always the true cash impact; `driverDisplay()` presents investment contributions and full debt payoffs as equity-positive (emerald, "+") so saving is never framed as loss. Routine debt payments display as outflows.
**Alternatives:** flip signs in the engine; show everything as raw cash flow.
**Reasoning:** engine stays truthful for calculations and future AI input; display layer carries the owner-created-equity product principle (mockups show "Investment +$500" in green).
**Consequences:** display semantics live in one tested function (`driverDisplay`); AI narration must use the same semantics.

## 6. 2026-07-15 — Demo "today" is a fixed date

**Decision:** Koa Holdings history ends at a hard-coded 2026-07-15 with a fixed PRNG seed.
**Alternatives:** generate relative to the real current date.
**Reasoning:** full determinism — identical charts in tests, screenshots, reviews; no snapshot drift between runs.
**Consequences:** the demo dashboard always shows the same "today"; acceptable until real data phases.

## 7. 2026-07-15 — Supabase infrastructure pulled forward ahead of remaining Phase 1 screens

**Decision:** build auth (magic link/PKCE), schema + RLS (migrations 0001/0002), the snapshot builder, demo-seed pipeline, and a DB-backed dashboard now, before the rankings/data/report screens land.
**Alternatives:** finish all Phase 1 screens on demo-only (in-memory) data first and defer persistence to Phase 3 as originally sequenced (see #3).
**Reasoning:** user decision. Validating the real data path — auth, RLS, snapshot derivation — early de-risks the highest-uncertainty parts of the system before more UI is built on assumptions that only hold for demo data. This supersedes #3's deferral: #3's noted consequence ("env vars flip from optional to required then") has now happened.
**Consequences:** ROADMAP's Phase 3 boundary narrows — schema, RLS, and auth are already done, so Phase 3 is now "manual data + CSV import" on top of live infrastructure. Rankings/data/report screens still ship on mock/demo data next, but now sit on top of a real Supabase project rather than a purely synthetic one.

## 8. 2026-07-15 — Daily snapshots store raw dollar components; index computed at read time

**Decision:** `daily_snapshots` (migration 0001) persists raw numeric components — `liquid_assets`, `revolving_balances`, `near_term_obligations`, `essential_obligations`, `safety_buffer`, `net_worth` — not a precomputed index/baseline/waterline.
**Alternatives:** store the computed index, baseline, and waterline per day alongside the components.
**Reasoning:** the index anchor (FINANCIAL_INDEX_METHODOLOGY) is a pure function of the raw component history. Storing only components lets methodology changes (anchor formula, scale floor, future score versions) replay against history without a data migration, and keeps `financial-engine` the single source of truth for derived math.
**Consequences:** every dashboard read recomputes index/baseline/waterline from the stored raw series (cheap — pure functions over a bounded window). `health_score`/`score_version` columns from the original DATA_MODEL draft are deferred to Phase 2 when score work begins; the draft's inline `financial_index`/`available_position` fields are superseded by the implemented raw-components shape.

## 9. 2026-07-15 — Magic-link-only auth

**Decision:** Supabase auth configured for email magic link (PKCE flow) only — no password, no OAuth providers, in this phase.
**Alternatives:** password auth; social OAuth (Google, etc.).
**Reasoning:** magic link removes password storage/reset surface entirely, matching a personal-finance product's low-friction, low-attack-surface bar for this phase. PKCE via `/auth/callback` is the modern secure pattern for browser redirect auth.
**Consequences:** `admin.generateLink` (used for local dev bootstrap) emits implicit tokens, not PKCE codes, so `scripts/dev-login.ts` can't hit the code-only callback directly — it uses `verifyOtp` instead. The production email-click flow is architecturally sound but unverified end-to-end with a real inbox (see KNOWN_LIMITATIONS). All future auth settings must live in `supabase/config.toml`: `supabase config push` syncs the whole `[auth]` section, so any setting configured only via dashboard is reverted on the next push (see SECURITY_MODEL).

## 10. 2026-07-15 — Demo data seeds through the real persistence pipeline

**Decision:** the demo generator's accounts and transactions are written to Supabase (`financial_accounts`/`transactions` with `provider = 'demo'`) through the same server actions and snapshot builder a real data source would use, rather than a synthetic in-memory-only demo path.
**Alternatives:** keep demo data client-side/in-memory (as in Phase 0–1) and wire real persistence separately later.
**Reasoning:** exercising the real insert → snapshot-build → RLS-read path with demo data is the cheapest way to prove the persistence and security layers work before any real user data exists, and it means the dashboard has no separate demo-only code branch to maintain.
**Consequences:** `clearDemoData` currently deletes by `user_id` (all `financial_events`/`daily_snapshots` for that user, plus `financial_accounts` where `provider = 'demo'`) — correct while demo is the only data source, but must become source-scoped once manual/CSV data coexists with demo data (see KNOWN_LIMITATIONS).

## 11. 2026-07-15 — `middleware.ts` renamed to `proxy.ts`

**Decision:** the Next.js route guard lives at `src/proxy.ts`, not `src/middleware.ts`.
**Alternatives:** keep the `middleware.ts` name used through Phase 0–1 planning and in the original ARCHITECTURE.md wording.
**Reasoning:** Next.js 16 renamed the route-interception convention from `middleware` to `proxy`; the app pins to Next 16.2.10, so the new filename is required for Next to pick it up.
**Consequences:** "middleware" in older docs/discussion refers to what is now `src/proxy.ts`; re-check this convention name on future Next major-version upgrades.

## 12. 2026-07-15 — Transactions/categorization UI will be a dashboard drill-down, not a nav item

**Decision:** when Phase 3 ships the transaction list and correction workflow (recategorization, essential/discretionary marking, transfers, splits), it will live as a drill-down from the Home dashboard (e.g. tapping "Available Capital" or "What moved your line" → transaction detail), not as a fifth bottom-nav tab or a settings subsection. User approved this direction.
**Alternatives:** fifth nav item ("Accounts"); accounts section behind profile/settings.
**Reasoning:** the mockups define a four-tab nav (Home/Rankings/Data/Report) with no transactions surface, and the product addendum's UX hierarchy requires the diagnosis (score, drivers, actions) above dense transaction lists — a drill-down keeps detail beneath the diagnosis instead of promoting it to a peer destination.
**Consequences:** Phase 3's plan should design the drill-down entry points and routes (likely `/accounts` or `/transactions` reachable from dashboard cards); bottom nav stays four tabs; deep-linking to a specific transaction remains possible via route, just not via nav.

## 13. 2026-07-16 — Uniform override edit model; archive-not-delete accounts; manual txns only on manual accounts

**Decision:** all transaction edits — demo or manual — write `user_override` (category/description) or the mutable `notes` column; amount/date mistakes on manual transactions are fixed by delete + re-add. Accounts are archived (`archived_at`), never deleted. Manual transactions may only be created in `provider='manual'` accounts; imported (demo/csv) transactions can never be deleted. Snapshot rebuilds read source columns only, so overrides never move the index.
**Alternatives:** relaxing the 0002 immutability trigger for manual rows; hard-deleting accounts; allowing manual txns in demo accounts.
**Reasoning:** one provenance rule for every provider keeps the trigger untouched and the audit trail complete; account.provider stays the single source of a transaction's origin; archived accounts preserve history for past snapshots.
**Consequences:** recategorizing to/from `income` changes report groupings but not obligations or the index (v1 — revisit with the Phase 2 metric registry); manual edit UX for amount/date is delete + re-add.
