# Post-CSV-merge cleanup slice — design

Date: 2026-07-17. Status: approved for planning.

## Purpose

Close out debt items surfaced or activated by the CSV import merge (PR #2, `91c6fbf`) so the completed phases (0, 1.5, 2, and Phase 3's landed slices) are genuinely clean before the next feature slice (demo profiles + switcher). Four items; roughly a half-day.

## Findings that shaped scope (verified against code, 2026-07-17)

- **`clearDemoData` is NOT a live bug.** In `src/app/actions/demo.ts`, the accounts delete is already scoped `provider = "demo"` and transactions cascade only from those accounts, so imported/manual rows survive. `daily_snapshots` are deleted wholesale but are derived data, rebuilt immediately by `rebuildSnapshots`. `financial_events` are deleted wholesale but only the demo seed ever writes that table (manual CRUD and CSV import do not create events). The gap is latent: `financial_events` has no source column, which matters only when a second event source appears. → Doc correction, not a code fix.
- **`daily_snapshots.data_coverage_confidence` is vestigial.** Stamped `"demo"` unconditionally by `snapshotToRow` (`src/lib/data/mappers.ts:23`), never read anywhere; score confidence derives demo-ness at read time from account providers (`src/lib/financial-engine/metric-inputs.ts:245`, per DECISIONS #14). → Drop it.
- **MapStep CTA occlusion is real and specific to `MapStep`** (KNOWN_LIMITATIONS, CSV import v1 section): the in-flow "Preview import" button can render its bottom ~29px behind the fixed `BottomNav` at 390×844 at `scrollY = 0`. `main`'s `pb-28` provides scroll clearance but sits *below* the CTA, so it cannot prevent first-paint occlusion.

## Design

### 1. Migration `0005_drop_coverage_confidence`

Drop the `data_coverage_confidence` column from `daily_snapshots`.

- New migration `supabase/migrations/0005_drop_coverage_confidence.sql`: `alter table public.daily_snapshots drop column data_coverage_confidence;`
- `src/lib/data/mappers.ts`: remove the field from `SnapshotRow` and from `snapshotToRow`'s output. `rowToSnapshot` never read it — no change there.
- `src/lib/data/mappers.test.ts`: update `snapshotToRow` expectations.
- No behavior change: nothing reads the column. If persisted confidence returns with real providers (Phase 7), it gets a redesign with real inputs anyway.

### 2. Sticky action row in `MapStep.tsx`

- The Back / "Preview import" button row becomes `sticky bottom-20` (clears the ~61 px `BottomNav` plus a gap) with an opaque `bg-base` background, `z-10` — below the nav's `z-20`, above step content.
- The `!ready` helper text ("Choose a date, description, and amount column…") moves **above** the button row so the sticky row can never cover it.
- Behavior: in flow when content is short (unchanged look); pins above the nav exactly when it would otherwise be occluded. Always tappable at first paint.
- **Scope guard:** `PreviewStep`/`SummaryStep` CTAs get the same treatment **only if** live QA at 390×844 demonstrates they can occlude (Task 18 QA found them fine). No generalization without evidence.

### 3. Doc corrections

- `docs/KNOWN_LIMITATIONS.md` "Product (2026-07-15)":
  - Remove "No manual entry or CSV import yet" and "Financial-health score not yet implemented" (both resolved).
  - Reword the demo-data entry: demo is no longer the only data source; it remains the default seeded dataset.
- `docs/KNOWN_LIMITATIONS.md` `clearDemoData` entry (Infrastructure section): reword to the accurate residual — accounts/transactions already provider-scoped, snapshots derived and rebuilt; the latent gap is specifically that `financial_events` has no source column, mattering only when a non-demo event source exists.
- `docs/KNOWN_LIMITATIONS.md`: remove the MapStep-CTA entry (CSV import v1 section) and the `snapshotToRow` stamp entry (Manual data section) once fixed by this slice.
- `docs/ROADMAP.md`: check off Phase 1's "Onboarding flow" item (landed in Phase 1.5; checkbox stale).
- `docs/DECISIONS.md` #16: record the column drop (schema change; alternatives were stamp-meaningfully and defer; reasoning: write-only field that misstates provenance for rebuilt manual/mixed data, read-time confidence made it obsolete).
- `docs/CURRENT_PHASE.md`: updated at slice end.

### 4. Verification

- `pnpm check` green (lint + typecheck + test + build).
- Migration applied to the live Supabase project; `pnpm test:rls` re-run (19/19) since the migration touches an RLS-covered table.
- Live browser QA: `/import` MapStep at 390×844 and 1280×900 — CTA fully visible and tappable at first paint with the QA report's reproduction content; PreviewStep/SummaryStep spot-checked at 390×844; console clean.

## Out of scope (explicit)

- Transfer-pair one-sidedness on import (touches migration-trigger design — its own slice).
- Import dedupe TOCTOU / DB unique constraint.
- `dev-login.ts` implicit-flow fix (falls to the PWA + Playwright slice).
- `financial_events.source` column (YAGNI until a second event source exists).

## Error handling

Migration failure surfaces via Supabase CLI; the code change and migration land in one commit so a checkout is never half-migrated against its own schema expectations. No runtime error paths change.

## Testing

Covered by existing suites: `mappers.test.ts` (updated expectations), full engine/app suite unchanged, `test-rls.mts` re-run live. The sticky-row change is visual — verified by live browser QA, not unit tests (consistent with existing UI-slice practice).
