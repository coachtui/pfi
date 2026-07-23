# Score/Index Divergence Academy Lesson — Design (Spec 2)

_2026-07-22_

## Context

Spec 1 (`2026-07-22-score-index-divergence-explainer-design.md`, merged PR #28)
shipped `DivergenceExplainer` on the home dashboard: when PFI (the index) and the
Fundamentals Score (the 0–900 rating) move in opposite directions on the same day,
a line explains the moment and offers a `› Learn` control. That control currently
expands a short hardcoded paragraph inline (`LEARN_COPY` in
`DivergenceExplainer.tsx`) — an explicitly interim placeholder. Spec 1's own
follow-up note commits to this work:

> Author the full **"PFI vs Fundamentals Score"** Academy lesson (sections +
> knowledge checks + concept/lesson record + progress wiring) and repoint `›
> Learn` from the interim inline expand to the lesson route.

This spec is that fast-follow: a real Academy concept/lesson, and repointing
`› Learn` to it.

## Goals

- Give users a first-class Academy lesson explaining why PFI and the Fundamentals
  Score can disagree, using the project's existing concept/lesson data model —
  no new content system.
- Make the lesson discoverable on its own (via the Academy home list), not only
  reachable when a live divergence happens to be on screen.
- Replace the interim inline expand with real navigation to the lesson.
- Stay inside the existing, already-built Academy infrastructure: no new
  migration, no new progress-tracking mechanism, no new sheet/route pattern.

## Non-goals

- Wiring the lesson to the household's own live divergence occurrences. A real
  divergence is a transient, request-time signal (`computeDivergence` in
  `src/lib/financial-engine/divergence.ts`) with no stored history to query —
  making it "live" would require deciding where/whether to persist divergence
  events, which is materially more scope than this slice. The lesson ships
  sample-only, consistent with 6 of the 15 existing concepts that already
  authored a `dataMetricKey` ahead of their resolver landing.
- Changing `AIDivergenceExplainer.tsx` — it only threads the `sentence` prop
  through; nothing about the Learn control's target changes its behavior.
- Explaining PFI (the index) or the Fundamentals Score individually as
  standalone concepts. Out of scope here; noted as a natural future addition to
  the new module this spec creates.

## Concept record

New file: `src/lib/concepts/content/score-index-divergence.ts`.

| Field | Value |
|---|---|
| `id` | `"score-index-divergence"` — matches the existing technical vocabulary (`DivergenceDirection`, `computeDivergence`) rather than the display title, consistent with other concept ids being technical slugs. |
| `title` | `"PFI vs Fundamentals Score"` — matches the title already committed to in Spec 1's follow-up note. |
| `classification` | `"pfi_metric"` — this is specific to how PFI's own two headline numbers relate, not a standard finance term or a household adaptation of one. |
| `status` | `"published"` |
| `relatedConceptIds` | `["cash-flow", "liquidity"]` — cash-flow because that's what moves PFI day to day; liquidity because it's one of the Fundamentals Score's 90-day inputs. |
| `prerequisiteConceptIds` | `[]` — approachable standalone, since this is the one place explaining what the two headline numbers are in relation to each other. |
| `whereUsed` | `["Home dashboard's divergence explainer line"]` — the only surface today. |
| `dataMetricKey` | `"signal:divergence"` — authored now for forward compatibility; `concept-live.ts` only resolves the `report:*` namespace today, so this correctly renders sample-only content (same as `available-capital`'s `position:*` key, `cash-flow`'s `metric:*` key, etc.) until a future slice adds a `signal:` resolver. |
| `memorableDistinction` | `"PFI reacts today; the Fundamentals Score remembers the last 90 days."` |
| `formula` / `formulaRows` / `comparisonRows` | Omitted — divergence isn't a calculation, so these fields don't apply. `memorableDistinction` carries the one-sentence takeaway instead. |

`shortDefinition` / `fullDefinition` / `whyItMatters` explain, in plain terms,
that PFI and the Fundamentals Score can move in opposite directions because they
track different time horizons — PFI behaves like a daily share price reacting to
recent cash movement, the Fundamentals Score is a 90-day financial-health rating
— and that this is expected behavior, not a contradiction or a bug.

## Module placement

New module in `src/lib/concepts/modules.ts`:

```ts
{
  id: "understanding-your-score",
  title: "Understanding Your Score",
  order: 4,
  conceptIds: ["score-index-divergence"],
}
```

None of the 3 existing modules (household-operations literacy,
balance-sheet literacy, pressure/flexibility literacy) fit a lesson about
interpreting PFI's own headline numbers. A 4th module, seeded with just this one
lesson, gives PFI/product literacy its own home — and a natural place for future
lessons (e.g. "what is the Fundamentals Score", "what is PFI") if those get
written later. This makes the lesson appear on `/academy`'s list and count
toward the user's overall Academy progress, rather than only being reachable
when a live divergence happens to be on screen.

## Lesson content

`lesson.opening` hooks off the actual moment a user encounters this: paying a
large bill today drops PFI, but the Fundamentals Score doesn't move — which one
is right? Both.

`lesson.standardTerm` borrows the real finance/investing sense of "divergence"
(a price and an underlying indicator disagreeing, often a signal that a trend
isn't as strong as the headline number suggests) and maps it onto PFI vs.
Fundamentals Score, giving the word a legitimate anchor rather than inventing
PFI-only vocabulary.

`lesson.whyItMattersExtended`: without this distinction, a short-term dip can
read as a false alarm (or a short-term bump as false comfort) — understanding
the split protects users from over-reacting to noise or under-reacting to a real
multi-week trend.

`lesson.genericExample`: sample household pays a one-time $1,200 annual
insurance premium. PFI dips several points that day (it reacts to recent cash
movement); the Fundamentals Score is unchanged (it measures the steady
spending/saving pattern over the last 90 days, which this one payment doesn't
change).

`lesson.personalApplication`: `metricKey: "signal:divergence"`,
`requiresData: ["balance-history"]`, `interpretationRules` describing how to
read a real occurrence once live data exists. Renders sample-only today via the
same `HouseholdApplication` fallback path every not-yet-resolved concept uses.

`lesson.commonMisunderstanding`: "My score is broken / contradicting itself" —
reframed as: they're not disagreeing, they're answering different questions
("what happened today" vs. "how healthy is the household overall, over the last
90 days").

`lesson.completionSummary`: "You can now read a PFI/Fundamentals Score
divergence as a normal signal about time horizons, not a contradiction."

### Knowledge checks

Two checks, following the `<concept-id>-check-<n>` id convention:

1. **`score-index-divergence-check-1`** (`kind: "interpretation"`) — "Your PFI
   drops 4 points today after a large one-time payment, but your Fundamentals
   Score keeps improving. What's the best read?" Correct: they track different
   time horizons, this is expected. Distractors: "the score is wrong," "you
   should be worried," "PFI is the more accurate number."
2. **`score-index-divergence-check-2`** (`kind: "which-action"`) — given a
   described divergence scenario, which is the right response. Correct: check
   whether the underlying pattern has actually changed over time (not just
   today) before reacting. Distractors that over- or under-react to the single
   day's move.

## Repointing `› Learn`

`DivergenceExplainer.tsx` changes:

- Remove the `useState` toggle, the `LEARN_COPY` constant, and the inline
  expand paragraph.
- Replace the `Learn`/`Hide` toggle button with a real
  `<Link href="/academy/score-index-divergence">Learn</Link>`, navigating
  straight to the lesson route — matching Spec 1's explicit "repoint to the
  lesson route" plan, rather than opening the term sheet in place (this line
  isn't a single labeled metric like the `FinancialTerm`/`conceptId`-prop
  pattern elsewhere; it's a whole explanatory sentence, so linking straight to
  the full lesson is the more direct affordance).
- `AIDivergenceExplainer.tsx` is unaffected — it only threads `sentence`
  through to `DivergenceExplainer`.

## Progress wiring

None needed beyond what already exists. The new concept/module flow through the
existing `buildRegistry`/`validateRegistry`, `academy_progress` table,
`answerKnowledgeCheck` server action, and `LessonView`/`KnowledgeChecks`
components exactly like every other lesson concept. No migration.

## Testing plan

- **`DivergenceExplainer` component test:** replace the "toggle reveals inline
  paragraph" assertion with a "renders a link to
  `/academy/score-index-divergence`" assertion.
- **Registry validation:** the new concept and module pass
  `validateRegistry()`'s existing structural checks (kebab-case id, related-id
  existence, 1–2 knowledge checks, correct-index bounds, non-empty `whereUsed`)
  automatically, exercised by the existing registry test suite.
- **New concept content test:** a small test for
  `score-index-divergence.ts`, following the pattern used for other concept
  files.
- **`e2e/academy.spec.ts`:** no required changes to existing specs (they target
  other concepts); visual QA confirms the new lesson renders and completes
  end-to-end, and that clicking `Learn` on a live divergence line lands on the
  lesson.
- **Visual QA at 390px and 1280px:** since no demo profile naturally triggers a
  divergence (confirmed during Spec 1's Task 10), QA reuses the same throwaway
  override technique from that task to force the state, then confirms the
  `Learn` link navigates to the lesson and the lesson itself (sections,
  knowledge checks, completion) renders correctly at both widths.
- `pnpm check` green before completion, per project convention.

## Open questions

None — all decisions in this spec were confirmed during brainstorming
(module placement: new "Understanding Your Score" module;
personalization: sample-only for now; Learn target: direct lesson-route
navigation).
