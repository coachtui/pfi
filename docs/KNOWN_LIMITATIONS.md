# Known Limitations & Technical Debt

Recorded rather than hidden. Date-stamped; remove entries when resolved.

## Product (2026-07-15)

- **Demo data is the only data source.** Auth and persistence are live, but the only data flowing through the pipeline is Koa Holdings' seeded dataset, loaded via `loadDemoData()` through the real insert/snapshot pipeline (fixed "today" of 2026-07-15). No manual entry or CSV import yet (ROADMAP Phase 3).
- **Performance brief is template text** assembled from calculated metrics — clearly labeled; real AI narration is Phase 4.
- **Financial-health score not yet implemented** (spec in FINANCIAL_HEALTH_SCORE.md).

## Visual parity slice (2026-07-15)

- **Rankings and Data run on sample cohort data**, not a real cohort pipeline — league tabs, leaderboard, percentile compares, and benchmark metrics all read from the deterministic mock module `src/lib/demo-data/cohorts.ts` until Phase 6 builds anonymized cohorts with real minimum-size/suppression rules.
- **Rankings leagues and quarterly challenges are samples.** The Age/Income/Region/Overall tabs switch between four distinct but hand-authored sample leagues (no real cohort computation behind them), and challenge cards aren't wired to real progress; both are placeholders for Phase 6.
- **Chart stem chips (paycheck/mortgage/bonus markers below the axis) are approximate-positioned**, driven by plot-inset constants in `FinancialChart`/`src/lib/ui/math.ts` rather than exact plot geometry, and are hidden entirely on ranges longer than 45 days to avoid crowding.
- **Leaderboard row chevrons imply tappable rows that aren't tappable yet.** Rows read as links (mockup-mandated affordance) but don't navigate; they become real profile links once Phase 6 ships other cohort profiles.
- **`eventIcons` lives in `WhatMovedYourLine`** (`src/components/dashboard/WhatMovedYourLine.tsx`) but is imported by the chart layer (`src/components/chart/FinancialChart.tsx`), an inverted dependency (chart importing from dashboard). Extraction to a shared module is a candidate cleanup once a third consumer appears.
- **`railPositions`'s docstring overstates its overlap guarantee.** It says labels "never overlap," but when the label span can't fit within 0–100%, the overflow-compression step (`src/lib/ui/math.ts`) can push gaps below `minGapPct`, including down to a 0.01 floor — so labels can end up arbitrarily close, just not literally coincident.
- **3-up mobile grids (Data "Cohort trends", Rankings "Quarterly Challenges") stay `grid grid-cols-3` down to 390px** rather than switching to a horizontal-scroll row. Verified live at 390×844: card titles wrap to at most 2 lines and no stat/value is clipped, so the narrower columns read as compact-but-readable; kept as-is rather than adding scroll-row complexity for a marginal gain. Revisit if a future card variant adds more text.
- **The Home header's "LV. 7" chip is sample gamification data.** It renders `VIEWER_LEVEL` from the demo cohorts module (`src/lib/demo-data/cohorts.ts`), not a computed level; real leveling logic is part of the Phase 6 cohorts build.
- **The Data "How you compare" percentile scale footer (0th/50th/100th) is offset by the icon column (`pl-12`) but not the right ordinal column (`w-12`).** The "50th" label sits slightly left of the bars' true midpoint tick as a result (cosmetic).

## Report screen slice (2026-07-15)

- **`investments` is sourced from `investment_contribution` events, not transaction-level investment transfers.** This is the reliable signal in the current data model and is numerically identical to a transaction-level sum for the demo dataset; a documented refinement, not a defect.
- **The `FCF === owner-created equity` reconciliation identity is now verified end-to-end against the real demo pipeline** (`generateKoaHoldings()` → `buildDailySnapshots()` → `enumeratePeriods()` → `computePeriodStatement()`) for every enumerated period, at both monthly and quarterly granularity — see `report.test.ts`'s "computePeriodStatement — real pipeline" suite. That guarantee depends on the current demo transaction model, where every liquid-account flow is one of: income, non-transfer operating expense, or one side of the two coupled transfer types (investment contribution, revolving-debt payment). It will also need a market-appreciation term once real (non-demo) investment/property holdings arrive with actual price drift. A future manual-entry/CSV-import data model may introduce transaction shapes this model doesn't anticipate — e.g. non-income liquid inflows (refunds, gifts, transfers from external accounts), or transfers to non-revolving liabilities — which will need explicit handling in `computePeriodStatement` before the identity is guaranteed to still hold. This is now a documented data-model dependency, not an untested assumption.
- **The period index chart is not re-anchored to the window.** Short periods (e.g. a single month) may not start near 100, since the index is computed against the full history's baseline rather than rebased at the period start.
- **The full transactions set is sent to the client for the report screen.** Fine at demo scale; revisit pagination/server-side aggregation for real data volumes.
- **The period chart passes no event markers, even when events fall within the window.** Carried from Task 5's review; noted as a possible future enhancement, not a defect.

## Manual data (transactions/accounts slice)

- **Amount/date corrections are delete + re-add** on manual transactions (source columns are frozen by design). Revisit if users hit it often.
- **Overrides never move the index (v1).** Recategorizing a transaction to/from `income` changes list/report groupings but not obligation windows or snapshots. The Phase 2 metric registry should decide whether corrections feed calculations.
- **Manual `current_balance` is authoritative.** Adding transactions reshapes history backward from the entered balance; it never changes today's balance — balance updates are an explicit account edit.
- **Snapshot rebuild is full-history and non-transactional** (delete + reinsert, O(days)). Fine at household volume; the stale-index notice plus rebuild-on-dashboard-load covers the failure window. The staleness proxy only detects transactions newer than the newest snapshot; older divergence is healed on the next mutation or dashboard load.
- **`snapshotToRow` still stamps `data_coverage_confidence: "demo"`** even for rebuilt mixed/manual data — confidence modeling is Phase 2.
- **Transaction list loads the full filtered window** (no DB pagination yet); month grouping is client-side.

## Infrastructure (2026-07-15)

- **Obligations v1 uses actual forward transactions, not detected recurrence.** The snapshot builder's obligation windows (FINANCIAL_INDEX_METHODOLOGY.md "Snapshot derivation") sum real transactions in a window and fall back to a fixed 28-day previous-cycle proxy near the end of known history; that proxy can still land a window past `endDate` when the actual income gap exceeds 28 days. Real recurrence detection arrives with real (non-demo) imports.
- **Mortgage/property balances are static.** No principal amortization schedule; a mortgage account's balance only moves via recorded transactions, not an accrual model.
- **Demo market drift removed.** The demo generator no longer simulates investment market appreciation independent of contributions — see the "contributions vs market appreciation" gap in FINANCIAL_INDEX_METHODOLOGY.md, still unaddressed for real investment accounts.
- **Magic-link email deliverability is unverified on default SMTP.** Supabase's default email provider has low rate limits and no deliverability guarantees; production magic-link flow has not been exercised end-to-end with a real inbox click (DECISIONS.md #9). A transactional email provider is needed before real users onboard.
- **`clearDemoData` clears all `financial_events`/`daily_snapshots` for the user, not just demo-sourced rows.** Correct while demo is the only data source (DECISIONS.md #10); must become source-scoped once manual/CSV data can coexist with demo data.
- **Migration 0002's transaction-immutability trigger blocks legitimate backfills.** Any future script that needs to correct a transaction source column directly (rather than through `user_override`) must disable `transactions_immutable_source` around the update and re-enable it after.
- **Onboarding retry keeps first-attempt form values** rather than resetting them, which is usually desirable but hasn't been deliberately verified against every field type.
- **`OnboardingForm.tsx` imports `next/dist/client/components/redirect-error`,** a private Next.js internal path (`isRedirectError` has no public export in this Next version). Build-fails-loud on a Next upgrade that moves/removes it, rather than failing silently.
- **Lockfile engines want `node>=22`; repo has no `engines` field and pins `@types/node@^20`.** No enforced Node version; works today but is a latent mismatch.

## Technical (2026-07-15)

- **Chart texture is jagged-er but still subtler than the mockup art** even after the widened demo spending variance (2026-07-15): the mockups are illustrative; further tuning is bounded by the demo tests' solvency/arc constraints.
- **Bottom nav on desktop:** tab bar persists at all viewports. Acceptable for prototype; consider a rail/top nav at `lg+` later.
- **`% Today`** is the day-over-day change of the index level, which reads large when the index level is far from its scale; consider switching to index-point change display.
- **No Playwright yet;** browser verification is manual/screenshot-based.
- **No PWA manifest yet.**
- **Percent/number formatting** is US-locale hard-coded; internationalization out of scope for now.
- **Latent redirect loop if a `personal_companies` row is deleted after onboarding completes** (`/` ↔ `/onboarding`); unreachable via the UI today (2026-07-15).
- **`src/proxy.ts` PUBLIC_PREFIXES uses `startsWith("/auth")`** — a future route like `/authors` would silently become public; tighten to exact segments when routes grow (2026-07-15).
- **`supabase/config.toml` auth URLs are localhost-only;** any deploy must add the deployed origin to `site_url`/`additional_redirect_urls` (2026-07-15).
- **`transactions.transfer_pair_id` has no FK/same-owner constraint.** RLS prevents any leak; this is an integrity-only gap for a future migration (2026-07-15).
- **Trigger functions lack pinned `search_path=''`** (Supabase linter warning class); add via `alter function` in a future migration (2026-07-15).
- **No `engines` field in package.json** while Supabase packages declare `node>=22` (local Node 24 fine) (2026-07-15).
