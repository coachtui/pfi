# Academy Slice 3 — Academy home, lesson experience, knowledge checks, progress tracking

**Date:** 2026-07-21
**Status:** Approved (brainstorm decisions recorded below)
**Depends on:** Slice 1 (concept registry + terminology, PR #20), Slice 2 (`FinancialTerm` interaction system, PR #21)

## Purpose

Ship the learning loop the first two slices prepared: a place to see and take the
10 authored lessons (`/academy`), the lesson experience itself with knowledge
checks, DB-backed per-user progress, and the "completed vs pre-completion" term
sheet variants with a "Take the lesson" CTA. After this slice, tapping any
canonical term can end in an actual lesson, and finishing lessons visibly
deepens what the app shows you.

## Scope

**In**

- `/academy` home: progress card, continue-learning card, module sections with
  per-concept state rows, recently-completed list.
- `/academy/[conceptId]` lesson pages for the 10 lesson-bearing concepts:
  Lesson · Related tab shell, 10-part lesson rendering, knowledge-check UI.
- `academy_progress` Supabase table (+ RLS) with server actions; status is
  always derived, never stored.
- Term sheet: "Take the lesson" CTA (pre-completion) and the completed variant
  with unlocked analytical depth ("Review lesson" CTA).
- Bottom-nav 5th tab: Academy.
- `MetricCard` invalid-interactive-nesting fix (KNOWN_LIMITATIONS item marked
  "resolve before Slice 3").

**Out (Slice 4)**: "Your Data" tab (`personalApplication` rendering),
reinforcement engine, analytics events.

**Not in the MVP at all** (per Slice 1 spec + brainstorm): streaks, fluency
ladder, locked concepts, filter chips, leaderboards, video, certifications.

## Product decisions from this brainstorm (2026-07-21)

1. **Navigation:** Academy is a 5th bottom-nav tab (Home · Rankings · Data ·
   Report · Academy), matching the mockups. `BottomNav` tab padding tightens
   (`px-4` → `px-3`) so five tabs fit at 390px.
2. **Streak counter (ACADEMY_VISUAL_DIRECTION deviation 1): omitted entirely.**
   The progress card communicates fluency (lessons completed, modules
   progressed, % complete), never daily pressure.
3. **No locks (deviation 2):** three neutral states — Not started / In
   progress / Completed. No padlock iconography anywhere. Prerequisites render
   as a gentle "Builds on: …" hint, never a gate. Every concept's definition
   stays reachable at all times via the term sheet.
4. **Completion semantics:** a concept is Completed when the user reaches the
   end of the lesson and has answered all of its 1–2 knowledge checks — right
   or wrong. Checks teach (explanation shows either way, per Slice 1 spec);
   they never gate. Responses are recorded for future comprehension signal.

## Architecture (Approach A, approved)

Server-rendered routes + server actions + Supabase progress — the same pattern
as `/score` and `/report`. Rejected alternatives: a stepper/pager lesson
(section-level state the MVP doesn't need), sheet-based lessons (poor
long-form mobile UX, no deep links, fights the back button).

### Routes

- `/academy` — server component; loads the registry (compile-time) and the
  user's `academy_progress` rows; renders home. Skeleton loading state; the
  zero-progress render is the empty state.
- `/academy/[conceptId]` — server component; `notFound()` for unknown,
  unpublished, or glossary-only ids. Loads that concept's progress row (and
  responses) so answered checks render answered on return visits.
- Both auth-gated like the rest of the app (existing proxy/consent gate).

### Data model — migration `0012_academy_progress.sql`

```sql
create table public.academy_progress (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  concept_id text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check_responses jsonb not null default '[]',
  primary key (user_id, concept_id)
);
```

- Owner-only RLS: the same four `auth.uid() = user_id` policies as
  `ai_narrations` (0009). No cross-table FK beyond `user_id`, so no ownership
  trigger is needed.
- No FK for `concept_id` — concepts are compile-time code. Server actions
  validate every id against the **published, lesson-bearing** registry set and
  reject others.
- `check_responses`: jsonb array of `{ checkIndex, choiceIndex }`. Correctness
  is never stored — it is derivable deterministically from the registry
  (deterministic code calculates; storage holds raw responses only).
- **Status is derived, never stored:** no row = Not started; row with null
  `completed_at` = In progress; `completed_at` set = Completed.
- Progress belongs to the authenticated user and does not vary with the
  demo-profile switcher.

### Server actions — `src/app/actions/academy.ts`

- `startLesson(conceptId)` — validates id, upserts the row (no-op if present).
  Fired once from the lesson client component on mount (server components
  don't mutate on GET).
- `answerKnowledgeCheck(conceptId, checkIndex, choiceIndex)` — validates id,
  bounds-checks `checkIndex`/`choiceIndex` against the registry lesson,
  ignores duplicate `checkIndex` (first answer wins; the UI disables answered
  checks). When every check of that lesson has a response, sets
  `completed_at` in the same action. Returns the updated responses +
  completion state for optimistic-free re-render.

### Derivation logic — `src/lib/concepts/progress.ts` (framework-free)

Pure functions over registry + progress rows, unit-tested and extractable like
`term-sheet.ts`: `conceptStatus(row)`, module and overall tallies
(completed X of 10 lessons, modules progressed), `nextUpLesson(registry, rows)`
(first not-completed lesson in module order), recently-completed selection.
No React/Next imports.

## Academy home UI

- **Header:** "Academy" + the "Master the language of finance" subline.
- **Progress card:** ring paired with explicit numbers (accessibility: never
  color/shape alone) — lessons completed X/10, modules progressed Y/3,
  % complete. Nothing else (no streak/mastery/level).
- **Continue learning:** `nextUpLesson` with its one-line hook
  (`shortDefinition`) and a Continue button → lesson route. Hidden once all 10
  are complete (replaced by a quiet all-done state).
- **Module sections (3):** each concept a row — title, one-line short
  definition, right-side state as icon + text (✓ Completed / ● In progress /
  › Not started). Lesson-bearing rows navigate to the lesson. The 4
  glossary-only module concepts open the existing term sheet and carry no
  lesson state. `available-capital` (glossary-only, in no module) remains
  reachable via term sheets only — deliberate.
- **Prerequisites:** rows whose concept declares `prerequisiteConceptIds` show
  "Builds on: <titles>" as a hint; navigation is never blocked.
- **Recently completed:** last 3 completions with dates; rendered only when
  non-empty.

## Lesson experience

- **Tab shell:** Lesson · Related, an accessible tablist (roving tabindex,
  `aria-selected`). Slice 4 adds the mockups' "Your Data" tab into this shell;
  `personalApplication` is not rendered in this slice.
- **Lesson tab** — numbered sections mapping the 10-part template in order:
  intro; the standard term; why it matters (+ `whyItMattersExtended`);
  calculation (formula + walkthrough in a mono block, only when present); the
  Rivera-household example explicitly labeled as a sample; common
  misunderstanding; "where you'll see this in PFI" (`reinforcementPreview`).
- **Knowledge checks** at the end of the Lesson tab: single-tap multiple
  choice. Answering records via `answerKnowledgeCheck`, disables the check,
  shows the explanation (right or wrong), and marks the correct choice with
  icon + text — never color alone. Once all checks are answered, a completion
  confirmation appears. No retake pressure; answered state persists across
  visits.
- **Related tab:** related concepts with short definitions — lesson-bearing
  ones link to their lessons, glossary-only ones open the term sheet — plus
  `businessContext` when present.
- **Footer pager:** Previous/Next lesson in module order (across module
  boundaries; hidden at the ends).

## Term-sheet integration (Slice 2 surfaces)

- The root layout (already dynamic) fetches the user's completed concept ids
  and passes them to `TermSheetProvider`, which exposes them to the sheet.
- **Pre-completion sheet** (current content) gains a **"Take the lesson"**
  CTA for lesson-bearing concepts — closes the sheet and routes to
  `/academy/[conceptId]`.
- **Completed sheet** appends the unlocked analytical depth — `whyItMatters`
  and `businessContext` sections — plus a "Completed ✓" marker (icon + text),
  and the CTA reads "Review lesson".
- Glossary-only concepts keep the existing sheet unchanged (no CTA, no
  variants).
- `term-sheet.ts` stays framework-free; `buildTermSheetModel` gains a third
  parameter `{ completed: boolean }` and the returned `TermSheetModel` carries
  `hasLesson`, `completed`, and (when completed) the `whyItMatters` /
  `businessContext` depth fields. The null-degradation contract is unchanged.

## MetricCard nesting fix

When both `href` and `conceptId` are set, the card is **not** wrapped in
`<Link>`. It renders as a plain block: the term button lives in the label and
an explicit "View details →" link renders in the footer — sibling interactive
elements, valid HTML, one accessible name each. Cards with `href` only keep
today's whole-card link. Removes the KNOWN_LIMITATIONS entry (invalid
`<a>…<button>…</a>` nesting on "Available capital" / "Obligations").

## States, accessibility, privacy

- Loading: skeletons for both routes. Empty: zero-progress default render.
  Error: existing app error boundary. Partial data: N/A (content is
  compile-time; progress query failure falls back to Not-started rendering
  with a non-blocking notice — never fake completion).
- All state icons paired with text; tablist and checks fully keyboard
  operable; check results announced (`aria-live` on the explanation).
- Mobile-first: designed and verified at ~390px before desktop.
- `academy_progress` holds no financial data. No analytics events this slice
  (Slice 4); when they arrive they must respect the analytics-privacy rule.

## Testing

- Unit: `progress.ts` derivations (status, tallies, next-up, ordering);
  server-action validation (unknown/unpublished/glossary-only ids rejected,
  bounds checks, duplicate answers ignored, completion set exactly when all
  checks answered).
- Existing registry/content tests unchanged (registry untouched).
- e2e (Playwright): Academy tab visible and routable; home shows Not-started
  state; open a lesson, answer its checks, see completion on home; term sheet
  shows "Take the lesson" pre-completion and the completed variant + "Review
  lesson" after; MetricCard renders no nested interactive DOM.
- `pnpm check` green; live mobile (390px) + desktop verification.

## Files

New: `supabase/migrations/0012_academy_progress.sql`,
`src/app/actions/academy.ts`, `src/lib/concepts/progress.ts` (+ tests),
`src/app/academy/page.tsx`, `src/app/academy/[conceptId]/page.tsx`, and the
Academy view components under `src/components/academy/`.

Modified: `src/components/nav/BottomNav.tsx` (5th tab),
`src/components/concepts/TermSheetProvider.tsx` / `TermDefinitionSheet.tsx`
(variants + CTA), `src/lib/concepts/term-sheet.ts` (completed view-model),
`src/components/dashboard/MetricCard.tsx` (nesting fix), `src/app/layout.tsx`
(completed-ids fetch), docs (`CURRENT_PHASE.md`, `DECISIONS.md`,
`KNOWN_LIMITATIONS.md` entry removal, `docs/ROADMAP.md` if it tracks slices).

Unchanged: `src/lib/concepts/` content/registry/types (all lesson content was
authored in Slice 1), `financial-engine`, `demo-data`.
