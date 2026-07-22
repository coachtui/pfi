# Import Flow — Duplicate-Integrity Fix + Premium UX Redesign — Design

_Date: 2026-07-22. Status: approved in brainstorming (visual direction approved via iPhone mockup); implementation plan to follow._

Two workstreams on the account-import experience:

- **B — a data-integrity bug** in the PDF confirm path (every staged row shares `line: 2`, leaking the "import duplicate" whitelist across all rows).
- **C — a premium UX pass** on the whole import flow, which currently reads as "mickey mouse / AI slop": it diverged from the app's dark stock-terminal design system and dead-ends users.

The PDF feature (~5,500 lines, migrations `0013`/`0014`, ~14 commits `d476d40`→`6be47ce`) landed on `main` outside the documented workflow and is absent from `CURRENT_PHASE.md`, `KNOWN_LIMITATIONS.md`, and the test-status docs. This slice also closes that doc gap (light).

## Explicitly out of scope (deferred)

- **Async PDF processing rework.** `uploadStatementPdf` runs extraction + OCR (Tesseract, up to a 90s timeout) synchronously inside the request the client blocks on, despite the DB already having async statuses (`extracting`, `ocr_processing`) and a `getPdfImportReview(importId)` polling endpoint that nothing calls. This is the true "hanging" root cause and is the correct next slice, but it is **not** this one. Recorded in `KNOWN_LIMITATIONS.md` as part of this slice.
- New per-institution parser adapters, OCR quality work, brokerage/investment support.

## Scope decisions (confirmed with user)

| Question | Decision |
| --- | --- |
| Priority this session | Quick wins: the `line` bug (B) + the UX/CTA/navigation redesign (C). Async rework deferred. |
| Onboarding → first-import gap | **Light touch** — no new onboarding screen. Strengthen the empty-dashboard handoff (import primary, demo secondary, "you're set up" acknowledgment). |
| Redesign depth | **Fuller visual polish** — restyle the review screen (table → card list), states, chips, buttons across the flow; structure/logic unchanged. |
| Emerald accent | One emerald primary action per screen; secondary actions ghost/text. |
| Review layout | Card-per-transaction list on mobile; stays a list (wider) on desktop, not the cramped 7-col grid. |
| CSV "Recommended" badge | Soften — keep CSV's honest "best for accuracy" copy, drop the loud badge (don't steer away from PDF). |
| Design tooling | `/ui-ux-pro-max` drives the component-level visual build, per user request. Mockup: artifact `cb950881` (approved direction). |

## B — Duplicate-integrity fix

**Root cause.** `readPdfReview` (`src/app/actions/imports.ts:323`) maps every staged transaction to a literal `line: 2`. Downstream, `confirmPdfImport` builds `allowDuplicateLines: new Set(rows.filter(duplicateDecision==="import").map(r => r.line))` (`:790`) and `commitImportedTransactions` gates the exact-dedupe re-check on `seen.has(key) && !allowDuplicateLines.has(r.line)` (`:122`). Because all rows share `line === 2`, accepting **any one** duplicate whitelists **every** row against the commit-side exact-dedupe guard — so a row that is an exact `dedupeKey` match to an existing DB transaction (but not caught by the fuzzier client-side `likelyDuplicateTransaction`) can double-import.

**Fix.** In `readPdfReview`, assign each staged row a unique, stable `line`:

- Add a deterministic `.order(...)` to the staged-transactions query (e.g. by `source_page`, then `posted_date`, then `id`) so numbering is reproducible across reloads/re-opens.
- Map with the index: `line: idx + 1` instead of `line: 2`.

This aligns the PDF path with the CSV path (which already carries real line numbers) and makes `allowDuplicateLines` and the commit-side `byLine` map per-row correct. No schema change — `line` is a transient view-model field, not persisted.

**Isolation note.** The `line` value is a shared contract between the PDF/CSV view models and `commitImportedTransactions`. The fix stays inside `readPdfReview`'s mapping; no change to the commit function's signature or CSV behavior.

**Test.** Add a regression test asserting distinct `line` values per staged row and that accepting one duplicate does not exempt others from the exact-dedupe guard. Because `readPdfReview`/`confirmPdfImport` are Supabase-coupled server actions, prefer the thinnest testable seam: if the row-mapping (line assignment) can be extracted to a pure helper it is unit-tested directly; otherwise cover it via the existing e2e harness. Decide the exact seam in the plan.

## C — Premium UX redesign

Design law throughout: **honor the existing system** (`src/app/globals.css` tokens). Elevated cards with `--shadow-card` and `--radius-card`; thin `--border-subtle`; emerald (`--positive-strong`) as a restrained accent used once per screen; monospaced `tabular-nums` for every amount/balance/mask; **never state through color alone** — pair with icon, sign, or text (binding accessibility rule). Mobile-first at ~390px, verified at desktop.

### C1 — CTA label consistency
- `src/app/accounts/AccountsView.tsx:77`: `Import CSV` → `Import` (the `/import` route does CSV **and** PDF; the label is currently false).
- Keep the honest, context-appropriate labels: `EmptyDashboard` "Import financial data", `StaleDataBanner` "Import your latest statements", `RecurringSection` "import more history". Unify the verb to "Import"; strip format-specific words from entry points.

### C2 — Onboarding → first-import handoff (`EmptyDashboard.tsx`)
Light touch, no new screen. Reshape the empty dashboard into an intentional handoff: a brief "you're set up" acknowledgment, **one** clear primary "Import financial data" card (icon + honest sub-copy: "CSV is best for accuracy · PDF is a reviewed fallback"), and the demo-profile options demoted to a visibly secondary "Just exploring?" row. Mirrors mockup screen 01.

### C3 — In-wizard flow (`ImportWizard.tsx` + step components)
- Replace the `1. 2. 3.` numbered `<ol>` stepper with a segmented progress indicator: filled/current/upcoming segments + a named current step and "Step N of M" (mockup 02–04). Keep the existing step model and `STEP_LABELS`.
- Add missing **Back** affordances so users aren't forced into destructive "Cancel import" to correct a wrong turn: PDF upload → back to "choose"; PDF review → back to re-upload. Keep the top-left arrow (leaves to `/accounts`) distinct from step-level Back.
- The `choose` step's CSV/PDF cards adopt the mockup's considered card treatment (icon tile, title, one honest line each); CSV keeps "best for accuracy" copy, no loud badge.

### C4 — Error & dead-end states
- **Shared `InlineError` component** (AlertCircle icon + text, `role="alert"`), replacing the two literal `x {error}` renders at `PdfUploadStep.tsx:76` and `PdfReviewStep.tsx:309`. Audit for any other glyph-prefixed error text and route them through it.
- **Unsupported/blocked PDFs become a fork, not a wall.** When `review.status` is `unsupported`/`failed` (password-protected, brokerage, multi-account), render an actionable panel: name the reason plainly + offer real next steps — "Import a CSV instead" (routes into the CSV branch) and "Try a different PDF" — instead of only a disabled Confirm + Cancel (mockup 05). Pre-upload validation errors (`PdfUploadStep`) get the same guidance treatment where a next step exists.

### C5 — Review screen visual polish (`PdfReviewStep.tsx`) — the big one
Restyle without changing confirm/cancel logic:
- The 760px-wide 7-column `<table>` → a **card-per-transaction list**: date (mono) + description + category chip on the left; signed mono amount (colored + signed by direction) + confidence chip (icon-paired) on the right; include/exclude checkbox.
- Duplicate rows → a calm "already imported — excluded by default" strip with an explicit **"Import anyway"** toggle (icon + text, warning-muted surface), replacing the bare warning-colored checkbox label. This is also where the C-side of the `line` bug's UI lives.
- Summary stats (`detected / duplicates / low-confidence / issues`) and reconciliation status become proper stat chips up top, where the decision is made.
- Editing affordances (inline date/amount/category correction) are preserved; the plan decides whether inline-edit stays inline or moves into a per-row expand on mobile.

## Files touched (anticipated)

- `src/app/actions/imports.ts` — B fix (`readPdfReview` ordering + `line` mapping).
- `src/app/import/ImportWizard.tsx` — segmented stepper, Back affordances, choose-step cards.
- `src/app/import/PdfUploadStep.tsx` — `InlineError`, upload treatment, pre-upload guidance.
- `src/app/import/PdfReviewStep.tsx` — review redesign, dead-end fork, duplicate toggle, `InlineError`.
- `src/components/dashboard/EmptyDashboard.tsx` — handoff.
- `src/app/accounts/AccountsView.tsx` — CTA label.
- New `src/components/ui/InlineError.tsx` (or nearest existing UI-primitive location) — shared error.
- Possibly small shared bits (stepper, stat chip) if reused across CSV + PDF steps.
- Tests: PDF `line`-uniqueness regression; any component tests where they fit.
- Docs: `KNOWN_LIMITATIONS.md` (sync-processing limitation + doc-gap note), `CURRENT_PHASE.md` (this slice).

## Non-goals / guardrails

- No change to financial-engine calculations, dedupe/transfer logic, or the commit trust boundary.
- No new migrations. `line` stays a transient view-model field.
- CSV path behavior unchanged except shared UI primitives (stepper, `InlineError`) it already routes through.

## Verification

- `pnpm check` (lint + typecheck + test + build) green before completion.
- Visual verification at ~390px and desktop for every touched screen, in the browser.
- Manual pass of the `line` fix: a PDF import where one row is accepted as a duplicate does not import other exact-duplicate rows.
- Existing e2e (`smoke.spec.ts` CSV path) still green; PDF e2e remains out of scope for this slice (noted).

## Open micro-decisions (default chosen; veto at spec review)

1. Inline-edit on mobile review rows — keep inline vs per-row expand. _Default: keep inline; revisit only if 390px is too cramped._
2. Where the shared `InlineError`/stepper primitives live (`components/ui/` vs `app/import/`). _Default: `components/ui/` if reused beyond import._
3. Test seam for the `line` fix (extract pure helper vs e2e). _Default: extract a pure mapping helper if it's clean; else e2e._
