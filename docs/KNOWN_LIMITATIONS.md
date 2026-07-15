# Known Limitations & Technical Debt

Recorded rather than hidden. Date-stamped; remove entries when resolved.

## Product (2026-07-15)

- **Demo data is the only data source.** Auth and persistence are live, but the only data flowing through the pipeline is Koa Holdings' seeded dataset, loaded via `loadDemoData()` through the real insert/snapshot pipeline (fixed "today" of 2026-07-15). No manual entry or CSV import yet (ROADMAP Phase 3).
- **Report is a stub** with a Coming Soon state; a demo-data-computed version is the next Phase 1 slice.
- **Performance brief is template text** assembled from calculated metrics — clearly labeled; real AI narration is Phase 4.
- **Financial-health score not yet implemented** (spec in FINANCIAL_HEALTH_SCORE.md).

## Visual parity slice (2026-07-15)

- **Rankings and Data run on sample cohort data**, not a real cohort pipeline — league tabs, leaderboard, percentile compares, and benchmark metrics all read from the deterministic mock module `src/lib/demo-data/cohorts.ts` until Phase 6 builds anonymized cohorts with real minimum-size/suppression rules.
- **Rankings league tabs and quarterly challenges are static samples.** Switching Age/Income/Region/Overall doesn't change the underlying data, and challenge cards aren't wired to real progress; both are placeholders for Phase 6.
- **Chart stem chips (paycheck/mortgage/bonus markers below the axis) are approximate-positioned**, driven by plot-inset constants in `FinancialChart`/`src/lib/ui/math.ts` rather than exact plot geometry, and are hidden entirely on ranges longer than 45 days to avoid crowding.
- **Leaderboard row chevrons imply tappable rows that aren't tappable yet.** Rows read as links (mockup-mandated affordance) but don't navigate; they become real profile links once Phase 6 ships other cohort profiles.
- **`eventIcons` lives in `WhatMovedYourLine`** (`src/components/dashboard/WhatMovedYourLine.tsx`) but is imported by the chart layer (`src/components/chart/FinancialChart.tsx`), an inverted dependency (chart importing from dashboard). Extraction to a shared module is a candidate cleanup once a third consumer appears.
- **`railPositions`'s docstring overstates its overlap guarantee.** It says labels "never overlap," but when the label span can't fit within 0–100%, the overflow-compression step (`src/lib/ui/math.ts`) can push gaps below `minGapPct`, including down to a 0.01 floor — so labels can end up arbitrarily close, just not literally coincident.

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

- **Chart texture:** the demo actual line is visually smooth because near-term obligations decline roughly in step with liquid between paydays. Honest but less "market-like" than the mockups; consider modeling more spending variance when tuning demo profiles.
- **Bottom nav on desktop:** tab bar persists at all viewports. Acceptable for prototype; consider a rail/top nav at `lg+` later.
- **Chart markers** are simple dots on the line (direction-colored); the mockups show labeled stems below the axis. Revisit during Phase 1 polish.
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
