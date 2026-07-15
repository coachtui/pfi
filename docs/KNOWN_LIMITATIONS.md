# Known Limitations & Technical Debt

Recorded rather than hidden. Date-stamped; remove entries when resolved.

## Product (2026-07-15)

- **Demo data only.** No auth, no persistence, no real data. The dashboard renders Koa Holdings' seeded dataset with a fixed "today" of 2026-07-15.
- **Rankings / Data / Report are stubs** with Coming Soon states. Mock-data versions are the next Phase 1 slice.
- **No onboarding.** The demo profile is hard-wired.
- **Performance brief is template text** assembled from calculated metrics — clearly labeled; real AI narration is Phase 4.
- **Financial-health score not yet implemented** (spec in FINANCIAL_HEALTH_SCORE.md).

## Technical (2026-07-15)

- **Chart texture:** the demo actual line is visually smooth because near-term obligations decline roughly in step with liquid between paydays. Honest but less "market-like" than the mockups; consider modeling more spending variance when tuning demo profiles.
- **Bottom nav on desktop:** tab bar persists at all viewports. Acceptable for prototype; consider a rail/top nav at `lg+` later.
- **Chart markers** are simple dots on the line (direction-colored); the mockups show labeled stems below the axis. Revisit during Phase 1 polish.
- **`% Today`** is the day-over-day change of the index level, which reads large when the index level is far from its scale; consider switching to index-point change display.
- **No Playwright yet;** browser verification is manual/screenshot-based.
- **No PWA manifest yet.**
- **Percent/number formatting** is US-locale hard-coded; internationalization out of scope for now.
