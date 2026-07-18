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

## 14. 2026-07-16 — PFI Score v1: six weighted dimensions, unscored Protection, Momentum overlay, compute-at-read

**Decision:** the v1 health score uses six weighted dimensions (Cash Flow 25 / Liquidity 20 / Debt 20 / Stability 15 / Growth 15 / Concentration 5). Protection is displayed as a status (`not_assessed` in v1) and carries no weight; Momentum is a deterministic directional overlay derived from score history, not a seventh dimension. Missing data follows a deterministic policy: dimensions without their required core metric are ineligible (never neutral-filled), weights renormalize over eligible dimensions, a full score requires Cash Flow + Liquidity eligible and ≥4/6 eligible, 4–5 eligible is labeled provisional, otherwise the overall score is suppressed. Scores are computed at read time as a pure function of snapshots/transactions/accounts + `PFI_SCORE_VERSION` — no `health_score` columns, no migration. Score deltas follow the shared 30D/90D/1Y/All range picker. User-facing copy uses consumer language (monthly surplus, emergency runway, debt burden — no FCF/owner-created-equity jargon in score UI). FINANCIAL_HEALTH_SCORE.md is the normative spec.
**Alternatives:** seven weighted dimensions with Protection at 5% (prior provisional spec); neutral-filling or range-capping missing dimensions; Momentum as a weighted dimension; persisting daily scores in `daily_snapshots` (migration 0004); a fixed 30-day delta period.
**Reasoning:** Protection has no direct data source in v1 and inferring it from bank data would fabricate a number; Momentum as a dimension would double-count movement already captured per dimension; eligibility + renormalization is the only missing-data strategy that neither invents nor punishes; compute-at-read matches DECISIONS #8 (derived values at read time) and rebuildSnapshots() rewrites snapshot rows on every mutation anyway, so stored scores would not actually preserve history today.
**Consequences:** version bumps recompute displayed history (disclosed in UI) until scores are persisted — revisit persistence when non-rebuildable provider data lands (Phase 7); adding Protection to the weighted score later requires documented methodology, direct user inputs, missing-data rules, compliance review, and a version bump; the report screen's "Free cash flow" / "Owner-created equity" labels need consumer-language relabeling for consistency.

## 15. 2026-07-17 — CSV import architecture

**Decision:** client-side parse (the raw file never leaves the browser) feeding a server-action trust boundary that re-validates and re-derives everything server-side; a framework-free `src/lib/csv-import/` module (parse/detect/normalize/dedupe/transfers); provenance via `transactions.import_batch_id` only — no staging table, no `import_batches` table, batch summaries are derived by grouping on `import_batch_id` at read time (`getRecentImports`); imported rows are corrected via `user_override` (same uniform edit model as DECISIONS #13) and removed only by whole-batch undo (`undoImport`), never a per-row delete; transfer pairs are recorded on the new row only, since migration 0002's source-column immutability trigger (extended in migration 0004 to cover `import_batch_id`) forbids updating an existing row's `transfer_pair_id` to point at a newly imported counterpart.
**Alternatives:** server-side parse + staging table (rejected — more moving parts, no v1 benefit: the browser is already a trusted-enough boundary for a file the user chose to upload, and a staging table just adds a second write path to keep consistent with the real `transactions` table); one-shot import without preview (rejected — guts the review loop that lets a user catch a wrong column mapping or sign convention before anything is committed).
**Reasoning:** matches DECISIONS #8's compute/derive-at-read-time pattern (no new persisted-summary table to keep in sync) and #13's uniform override model (one correction mechanism for every transaction provider, not a CSV-specific one); keeping `csv-import/` framework-free preserves the same future-extraction path already committed to for `financial-engine`/`demo-data`. See `docs/superpowers/specs/2026-07-17-csv-import-design.md` for full rationale, the UI flow, and the out-of-scope list.
**Consequences:** an import batch has no first-class row of its own — undo and "recent imports" are always a derived query over `transactions.import_batch_id`, so deleting the last row of a batch makes that batch disappear from history with no separate record; when the counterpart of a transfer pair already exists as a prior transaction, that existing row cannot be updated to carry the pair link, so its confidence penalty for being an unresolved transfer persists even after the new row imports as the matched half (documented in KNOWN_LIMITATIONS).

## 16. 2026-07-17 — Drop the write-only `daily_snapshots.data_coverage_confidence` column

**Decision:** migration `0005_drop_coverage_confidence` removes the column; `snapshotToRow` stops stamping it.
**Alternatives:** stamp it meaningfully per rebuild (derive demo/manual/mixed from the providers of accounts feeding that rebuild); keep it and doc-note it as vestigial until Phase 7.
**Reasoning:** the column was write-only — stamped `"demo"` unconditionally, never read. Score confidence is computed at read time from account providers (#14, `metric-inputs.ts`), which made the persisted field obsolete; after the manual-CRUD and CSV-import slices it actively misstated provenance for rebuilt manual/mixed snapshots. A field that lies is worse than no field, and speculative stamping logic nothing consumes fails YAGNI.
**Consequences:** schema stays honest. If persisted coverage confidence returns with real provider sync (Phase 7), it gets a fresh design with real inputs (sync freshness, connection health) rather than inheriting a placeholder.

## 17. 2026-07-17 — Demo profile registry with data-only switching

**Decision:** three hand-authored deterministic demo profiles (Koa Holdings unchanged; Blue Reef Partners — early-career under strain; North Shore Capital — debt-free, concentrated) behind a metadata registry (`src/lib/demo-data/profiles.ts`, client-safe) and a server-side generator map (`generators.ts`); `loadDemoData(profileId)` validates against the registry and defaults to Koa; switching replaces demo rows only (provider-scoped clear → seed → rebuild) and never touches the user's company identity or cohorts; the active profile is detected at read time by matching seeded demo-account display names against per-profile signature names — no schema change.
**Alternatives:** one parameterized generator (rejected — rewrites the tuned, test-pinned Koa generator for no user-visible gain); full persona switch overwriting `personal_companies`/`user_profiles` (rejected — destructive to the user's own onboarding identity, needs save/restore bookkeeping); onboarding-only profile choice (rejected — reviewers couldn't flip personas in one session); persisting the active profile id in a column (rejected — a schema change for derivable demo-only state).
**Reasoning:** the two new personas exist to exercise states Koa can't (below-waterline, low bands, high utilization, irregular income; debt-free rule, concentration penalty, high bands), and per-profile persona-invariant tests prove they actually do; splitting metadata from generators keeps generator code out of client bundles; signature-name detection is an accepted heuristic for demo-only state (KNOWN_LIMITATIONS).
**Consequences:** demo-data UI copy must keep the profiles clearly fictional; renaming a signature account in a generator without updating its registry meta breaks detection (guarded by a registry test); the switcher gives `clearDemoData` its first UI entry point.

## 18. 2026-07-17 — Paginate `rebuildSnapshots`' unbounded queries past PostgREST's 1000-row cap

**Decision:** `src/lib/data/rebuild-snapshots.ts`'s `transactions` and `daily_snapshots` (prior) fetches now go through a new `paginateAll` helper (`src/lib/data/paginate.ts`) that pages in batches of 1000 via `.range()` until a short page confirms the end, instead of a single unbounded `.select()`.
**Alternatives:** raise PostgREST's `db-max-rows` config (rejected — a project-wide config change with broader blast radius, doesn't fix any other unbounded query, and doesn't help until every environment is reconfigured); leave it and only document it (rejected — this silently produces wrong obligations/score numbers for real users, not just degraded accuracy, so document-only under-serves the actual risk).
**Reasoning:** found live while QA-verifying the demo-profiles slice: Blue Reef Partners' 1042 transactions were silently truncated to 1000 rows by Supabase's default PostgREST cap, which cut off income-date detection after 2026-06-05 (of a 2026-07-15 dataset) and left `near_term_obligations`/`essential_obligations` at exactly 0 for every day past that point — verified directly against the live database and confirmed fixed (recomputed value 150, matching the dataset's true value) after applying `paginateAll`. This is the same class of pre-existing risk KNOWN_LIMITATIONS already flagged for `getImportContext`/`importTransactions` (see the CSV import v1 section), but rebuild-snapshots.ts's instance was worse: it silently corrupts every displayed obligation/score number for the affected date range with no error surfaced, not merely degraded dedupe accuracy on one import.
**Consequences:** `getImportContext`/`importTransactions`'s equivalent unbounded fetches remain unfixed (out of scope for this narrow hotfix) — their KNOWN_LIMITATIONS entry is updated to drop the now-stale "mirrors rebuild-snapshots.ts" framing, since that instance no longer applies. Any account whose transaction or snapshot count grows past 1000 continues to need a `paginateAll` pass at each new unbounded query site; there is no repo-wide guard preventing a future unbounded `.select()` from reintroducing this risk elsewhere.
