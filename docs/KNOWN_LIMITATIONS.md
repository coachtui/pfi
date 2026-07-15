# Known Limitations & Technical Debt

Recorded rather than hidden. Date-stamped; remove entries when resolved.

## Product (2026-07-15)

- **Demo data is the only data source.** Auth and persistence are live, but the only data flowing through the pipeline is Koa Holdings' seeded dataset, loaded via `loadDemoData()` through the real insert/snapshot pipeline (fixed "today" of 2026-07-15). No manual entry or CSV import yet (ROADMAP Phase 3).
- **Rankings / Data / Report are stubs** with Coming Soon states. Mock-data versions are the next Phase 1 slice.
- **Performance brief is template text** assembled from calculated metrics — clearly labeled; real AI narration is Phase 4.
- **Financial-health score not yet implemented** (spec in FINANCIAL_HEALTH_SCORE.md).

## Infrastructure (2026-07-15)

- **Obligations v1 uses actual forward transactions, not detected recurrence.** The snapshot builder's obligation windows (FINANCIAL_INDEX_METHODOLOGY.md "Snapshot derivation") sum real transactions in a window and fall back to a fixed 28-day previous-cycle proxy near the end of known history; that proxy can still land a window past `endDate` when the actual income gap exceeds 28 days. Real recurrence detection arrives with real (non-demo) imports.
- **Mortgage/property balances are static.** No principal amortization schedule; a mortgage account's balance only moves via recorded transactions, not an accrual model.
- **Demo market drift removed.** The demo generator no longer simulates investment market appreciation independent of contributions — see the "contributions vs market appreciation" gap in FINANCIAL_INDEX_METHODOLOGY.md, still unaddressed for real investment accounts.
- **Magic-link email deliverability is unverified on default SMTP.** Supabase's default email provider has low rate limits and no deliverability guarantees; production magic-link flow has not been exercised end-to-end with a real inbox click (DECISIONS.md #9). A transactional email provider is needed before real users onboard.
- **`clearDemoData` clears all `financial_events`/`daily_snapshots` for the user, not just demo-sourced rows.** Correct while demo is the only data source (DECISIONS.md #10); must become source-scoped once manual/CSV data can coexist with demo data.
- **Migration 0002's transaction-immutability trigger blocks legitimate backfills.** Any future script that needs to correct a transaction source column directly (rather than through `user_override`) must disable `transactions_immutable_source` around the update and re-enable it after.
- **No styled `src/app/error.tsx`.** Uncaught errors below the root fall through to Next's default error UI rather than a designed empty/error state.
- **Load-demo button has no pending state.** `loadDemoData()` can take a few seconds (chunked inserts); the button gives no visual feedback while it runs.
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
