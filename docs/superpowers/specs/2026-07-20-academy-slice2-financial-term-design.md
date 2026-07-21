# Academy Slice 2 — the `FinancialTerm` interaction system (design)

_Date: 2026-07-20. Phase 4.5 (Financial Fluency: PFI Academy MVP), Slice 2 of 4._
_Depends on: Slice 1 (terminology + concepts), merged to main 2026-07-20 (PR #20, `06e2dc2`)._
_Governance: docs/TERMINOLOGY.md. Visual direction: docs/ACADEMY_VISUAL_DIRECTION.md._
_Roadmap: docs/ROADMAP.md, Phase 4.5 slice list._

## Goal

Make every canonical financial term that PFI renders **tappable**, opening a
pre-completion definition sheet drawn from the Slice 1 concept registry. This is the
first user-facing Academy surface: the "Contextual Reinforcement" layer's entry point
("what does this term mean?", answered in place, where the user meets the term).

No lessons, no Academy home, no progress tracking, no DB, no analytics yet — those are
Slices 3–4. Slice 2 ships the reusable interaction primitive and wires it into the three
surfaces Slice 1 already renamed to canonical terms: **report, dashboard, and score**.

## Scope

**In scope**

- A reusable `FinancialTerm` inline component (tappable term affordance).
- A single shared `TermDefinitionSheet`, driven by a `TermSheetProvider` context.
- Sheet content: short definition, full definition, formula (+ household adaptation
  when present), and tappable related-concept navigation.
- Explicit wrapping of canonical **term labels** on `/report`, the dashboard, and
  `/score`.
- Unit + e2e coverage and live mobile/desktop verification.

**Out of scope (deferred, by slice)**

- Slice 3: Academy home, lesson experience, knowledge-check UI, DB-backed progress
  tracking (Supabase + RLS), "completed vs pre-completion" sheet variants, unlocked
  analytical depth, a "Take the lesson" CTA.
- Slice 4: personalization/reinforcement rendering, analytics events.
- Not in the MVP at all: prose/AI-narration auto-linking of terms, fluency-level
  ladder, streaks, locked concepts (see ACADEMY_VISUAL_DIRECTION.md deviations 1–4),
  video, leaderboards.

## Binding constraints (from CLAUDE.md / project rules)

- **Mobile-first.** Design and verify at ~390px before desktop.
- **Never color alone.** The tappable affordance must be shape-based; the reserved
  green accent (progress/positive currency) must not be repurposed for it.
- **Deterministic content.** All sheet content is compile-time registry data — no
  fetch, no loading/error state, no AI. `src/lib/concepts/` stays framework-free and
  is not modified by this slice.
- **Every metric already offers "How is this calculated?"** — the term sheet
  complements that; it does not replace or duplicate the score page's existing
  calculation explanation.

## Architecture

Approach A (chosen): a provider mounts one sheet; `FinancialTerm` buttons call into it.

Three new client components under `src/components/concepts/`:

### `TermSheetProvider.tsx`

React context mounted once in the authenticated app shell. State:

- `stack: ConceptId[]` — navigation stack; the top is the visible concept.
- Derived `openConceptId = stack.at(-1) ?? null`.

API exposed via context + a `useTermSheet()` hook:

- `openTerm(id: ConceptId)` — resets the stack to `[id]` and opens.
- `pushTerm(id: ConceptId)` — pushes a related concept (deeper navigation).
- `backTerm()` — pops one level; closes if the stack empties.
- `closeTerm()` — clears the stack.

The provider **renders `TermDefinitionSheet` itself**, so pages never mount a sheet.
Only `published` concepts are openable (see safety below).

### `FinancialTerm.tsx`

Inline `<button type="button">` wrapping the term text:

- Dashed-underline affordance in a **muted** tone (e.g. `decoration-dotted`/
  `underline-offset` on `text-secondary`-adjacent color), inherits the surrounding
  font size/weight so it drops into statement rows and metric labels without reflow.
- Visible focus ring; `aria-label` = `"{title} — show definition"`.
- On click/Enter/Space → `openTerm(conceptId)`.
- **Dev-time safety:** if `conceptId` does not resolve to a `published` registry
  record, it renders the children as **plain text** (no button) — never a broken
  control in production — and a unit test fails so the miswire is caught in CI.

Props: `{ conceptId: ConceptId; children: ReactNode }`. `children` is the visible
label text (kept explicit so the rendered label and the registry title can differ if
a surface ever needs a variant, while the drift test keeps them aligned by default).

### `TermDefinitionSheet.tsx`

Built on the existing `src/components/ui/Sheet.tsx` (bottom sheet on mobile, centered
dialog ≥sm; already handles Escape, overlay click, `role="dialog"`/`aria-modal`).

Content, top to bottom, for the concept at the top of the stack:

1. **Short definition** — `concept.shortDefinition`, prominent (larger type). The
   spec-designated pre-completion definition.
2. **Full definition** — `concept.fullDefinition`.
3. **Formula** — `concept.formula` in a monospace block, rendered only when present.
   When `concept.householdAdaptation` is present, render it as a short labeled line
   beneath the formula (the household formula sometimes differs from the strict
   business definition — the project rule to separate these applies).
4. **Related concepts** — `concept.relatedConceptIds`, filtered to `published`
   records, each rendered as a tappable chip (a `<button>`) showing the related
   concept's `title`. Tapping calls `pushTerm(id)`, swapping the sheet content in
   place. Omitted entirely when there are no published related concepts.

Sheet header:

- Title = `concept.title`.
- A **back** control (`aria-label="Back"`) appears only when `stack.length > 1`;
  it calls `backTerm()`. The existing close control always calls `closeTerm()`.

Not shown (Slice 3's lesson owns these): why-it-matters, common misunderstanding,
generic/personal examples, knowledge checks, lesson CTA.

## Call-site wiring

Explicit `<FinancialTerm conceptId="…">` wrapping at each site where a canonical term
renders **as a label** (not inside deterministic commentary prose or AI narration —
that auto-linking is deferred). Sites, from Slice 1's rename map:

- **`src/app/report/ReportView.tsx`** — statement row labels: revenue, operating
  expenses, cash flow, free cash flow, owner-created equity (and any other canonical
  statement labels present). Each occurrence wrapped independently.
- **`src/components/dashboard/HomeDashboard.tsx`** — the "Available capital"
  key-metric label.
- **`src/app/score/ScoreView.tsx`** — Cash Flow Health dimension labels: "Free cash
  flow margin", "Typical monthly free cash flow".

Concept-id map (label → registry id) is enumerated during implementation from
`src/lib/concepts/registry.ts`; every id used must resolve to a `published` record.

## Accessibility

- `FinancialTerm` and related chips are real `<button>`s: keyboard-focusable,
  Enter/Space activate, visible focus ring.
- Affordance is **shape** (dashed underline), never color alone.
- Sheet: on open, move focus into the sheet; on close, return focus to the triggering
  element. Back and close controls each have distinct `aria-label`s. Escape closes
  (existing behavior).
- Verified with keyboard-only navigation in the e2e/live pass.

## Testing & verification

- **Unit (`FinancialTerm`)**: renders a `<button>` for a valid published id; renders
  plain text (no button) for an unknown/unpublished id.
- **Unit (`TermDefinitionSheet`)**: renders shortDefinition, fullDefinition, and
  formula when present; hides the formula block when absent; renders one chip per
  published related concept; a chip tap pushes the stack and swaps content; back pops
  it; close clears it.
- **Extend `src/lib/concepts/label-consistency.test.ts`**: every `conceptId` handed to
  a `FinancialTerm` at a wired call site resolves to a `published` registry record,
  and each wired label still matches the registry `title` for that concept (reuses the
  existing label↔registry drift-guard mechanism).
- **e2e (Playwright)**: on `/report`, tap a term → sheet opens with the correct title
  → tap a related-concept chip → content swaps → back → close. No new route (route
  count stays 20).
- **Live browse verify** at **390×844 first, then 1280×900**: affordance legible on
  dense statement rows and metric labels, sheet readable and scrollable, related
  navigation works, keyboard path works, zero console errors on `/report`, dashboard,
  and `/score` at both viewports. Test user and scratch artifacts cleaned up after.
- `pnpm check` green (lint + typecheck + test + build) before completion.

## Files

New:

- `src/components/concepts/TermSheetProvider.tsx`
- `src/components/concepts/FinancialTerm.tsx`
- `src/components/concepts/TermDefinitionSheet.tsx`
- `src/components/concepts/FinancialTerm.test.tsx` (+ sheet unit test, colocated or
  alongside)

Modified:

- Authenticated app shell (mount `TermSheetProvider`) — exact file confirmed during
  implementation (the layout wrapping the report/dashboard/score routes).
- `src/app/report/ReportView.tsx`, `src/components/dashboard/HomeDashboard.tsx`,
  `src/app/score/ScoreView.tsx` (wrap labels).
- `src/lib/concepts/label-consistency.test.ts` (extend coverage).
- `tests/e2e/…` (new term-sheet flow).
- `docs/CURRENT_PHASE.md`, `docs/ROADMAP.md` (mark Slice 2), `docs/DECISIONS.md` if any
  structural decision arises.

Unchanged: `src/lib/concepts/` content and types — the registry already carries every
field the sheet renders.

## Open question deferred to Slice 3

The mockups' streak counter and "Locked" concept states conflict with the MVP scope
rule (no daily-streak pressure; comprehension never locked). Not relevant to Slice 2
(no Academy home here) — resolved at Slice 3's brainstorm per
ACADEMY_VISUAL_DIRECTION.md deviations 1–2.
