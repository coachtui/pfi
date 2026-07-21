# Academy content refinement — Slice A: schema extension + reference implementations

**Date:** 2026-07-21
**Status:** Approved (brainstorm decisions recorded below)
**Depends on:** Slice 1 (concept registry, PR #20), Slice 2 (`FinancialTerm` system, PR #21), Slice 3 (Academy home/lesson/progress, PR #22 — pending merge)

## Purpose

Slice 3 shipped the Academy's *architecture* — routes, progress tracking, the
lesson experience shell, the definition-sheet interaction layer. This work
refines its *content and presentation*: lessons currently read like generic
financial documentation rather than teaching through household situations,
and definition sheets can be dense or carry internal engineering language.
The product's stated aim is that a user finishes the Academy able to say "I
understand our free cash flow" — not just recite a definition.

This is the first of three planned slices refining Academy content. It is
deliberately scoped to validate the new content framework on two reference
concepts — Revenue (a full lesson) and Available Capital (a glossary-only,
PFI-specific definition sheet) — plus the schema extension and shared
components both depend on, before propagating the pattern to the other 9
lessons (Slice B) and 13 remaining definition sheets (Slice C).

## Explicitly preserved (not touched by this or any follow-on slice)

- `/academy` and `/academy/[conceptId]` routes, server-rendered pattern.
- `academy_progress` table, owner-only RLS, derived progress states (no
  row / in-progress / completed_at set — never stored as a field).
- Lesson-completion behavior: answering every knowledge check completes the
  lesson regardless of correctness; correctness is never persisted.
- Lesson/Related tab shell; the reserved future "Your Data" tab slot.
- Academy bottom-nav destination.
- The `Sheet` UI primitive and `TermSheetProvider`/`FinancialTerm` interaction
  layer (stack-based open/push/back/close).
- Existing server-action and mutation patterns (`"use server"`, auth-check,
  `{ error }`-shaped results).
- Mobile-first responsive behavior, dark surfaces, green accent, existing
  typography/borders/nav/tabs.

## Terminology/formula audit findings (from this brainstorm)

Confirmed already consistent — no fix needed:

- **Monthly surplus vs. free cash flow**: no metric literally named "monthly
  surplus" exists. Three related-but-distinct calculations share the "free
  cash flow" family — a period-sum (`report.ts` `freeCashFlow`), a 90-day
  margin ratio ("Free cash flow margin"), and a median-of-three-buckets
  figure labeled "Typical monthly free cash flow" (`recurring_surplus`
  internally). The user-facing name always says "free cash flow"; the engine
  already has a comment banning "surplus" as a stand-in term.
- **Savings rate**: confirmed retained-cash ÷ revenue (`report.ts:175`,
  `savings-rate.ts`), already explicitly distinguished in content from the
  looser popular "(income − spending) ÷ income" definition.
- **Net worth vs. equity**: the same field (`assets − liabilities`); "equity"
  is only ever a prose synonym, never a separate concept or data field.
- **Liquidity vs. Available Capital**: genuinely different formulas (a
  runway-in-months ratio vs. a dollar residual after netting revolving
  balances and near-term obligations); already cross-linked as related
  concepts.

Found and fixed by this slice's Available Capital rewrite:

- `available-capital.ts`'s `householdAdaptation` field contains literal
  internal engineering language — "...audit ruling, spec findings #6" —
  which renders verbatim in the live definition sheet. Removed as part of
  the reference rewrite (§6).

## Decisions from this brainstorm (2026-07-21)

1. **Sequencing**: three slices. Slice A (this spec) = schema + Revenue
   lesson + Available Capital sheet + audit writeup, reviewed before anything
   else changes. Slice B = roll the approved pattern out to the remaining 9
   lessons. Slice C = roll out to the remaining 13 definition sheets
   (Available Capital is the 15th and already done in Slice A).
2. **Household-data wiring is in scope now**, not deferred. Revenue's "Apply
   it to the household" section renders real report data (current value,
   prior-period change, primary driver) when it exists, a clearly-labeled
   sample household otherwise — it does not wait for a future "Your Data"
   tab. The reserved third tab slot stays empty/unbuilt; it's separate future
   work (likely deeper trend/driver visualizations).
3. **Schema approach**: adopt the user-supplied shape closely (§10 of the
   product brief), with three deliberate adaptations kept from the existing
   implementation because reversing them would be pure duplication with no
   behavioral gain:
   - No separate `slug` field — `id` already *is* the kebab-case slug.
   - No `moduleId`/`lessonOrder` back on the concept — `Module` already owns
     sequencing (a deliberate Slice 1 decision so reordering is one array
     edit); reintroducing per-concept ordering fields would duplicate that
     state.
   - `personalApplication` stays the existing structured binding
     (`{ metricKey, interpretationRules, requiresData }`), not a flat
     `householdApplication?: string`. A prose string cannot drive a real
     current-value/sample-fallback renderer — either it's static (no live
     data possible) or it requires embedding live figures in content, which
     directly violates the brief's own "never invent household figures"
     rule. The structured binding is what makes real-data rendering
     possible at all.
4. **Un-gating `whyItMatters`/classification content**: today's shipped
   sheet hides `whyItMatters` and `businessContext` until a lesson is
   completed. Per the brief's own progress-depth table (§8), these show at
   *every* state — only live personal-data analysis is new at Completed.
   This is an intentional behavior change from what Slice 3 shipped, matching
   the principle "completion deepens interpretation, it does not unlock the
   meaning of the term."
5. **Stable knowledge-check IDs**: `academy_progress.check_responses`
   currently stores `{checkIndex, choiceIndex}` (positional). Each
   `KnowledgeCheck` gains a stable `id: string`; responses store
   `{checkId, choiceIndex}`. Slice 3 is on an unmerged PR with no real user
   data yet, so this is a straight schema change now, not a backfill
   migration — the cost of this change only grows once real progress exists.
6. **Classification assigned to all 15 concepts now** (cheap, mechanical),
   even though only 2 get full content rewrites this slice — otherwise 13
   concepts would render an undefined classification badge mid-rollout.
7. **`Lesson` keeps fixed named fields; the generic `sections: LessonSection[]`
   array is dropped** (approved 2026-07-21, revising the earlier schema
   sketch). Mapping the sections model onto real content showed every
   proposed section kind already has a dedicated field doing the job
   (`fullDefinition`, `whyItMattersExtended`, `calculation.walkthrough`,
   `personalApplication` + `genericExample`) — the array would ship as
   unused machinery, and fixed fields are what lets `content.test.ts`/
   `validateRegistry` mechanically validate every lesson. All
   `FinancialConcept`-level additions stand unchanged.
8. **Migration-compat softening of two Lesson fields** (consequence of
   renaming types over 10 already-authored lessons that Slice B, not this
   slice, rewrites): `completionSummary` is optional (the completion card
   falls back to generic fluency copy naming the concept), and
   `calculation.formula` stays as an optional legacy field so the 9
   unmigrated lessons keep displaying their existing formula strings
   verbatim; renderer precedence is `concept.formulaRows` →
   `lesson.calculation.formula` → `concept.formula`. `reinforcementPreview`
   likewise becomes optional (superseded by `whereUsed` on migrated
   concepts; renderer prefers `whereUsed` when present). The three
   structurally-identical `KnowledgeCheck` union arms collapse into one
   interface with a `kind` union field — equivalent type, less noise.
9. **The definition sheet needs in-progress awareness** for the
   "Continue lesson" CTA: the root layout's completed-ids fetch widens to
   one query returning both started and completed concept ids
   (`getAcademyStatusIds`), replacing `getCompletedConceptIds`.
10. **Completed-state live data is fetched lazily, not at layout time.** A
   shared resolver (`src/lib/data/concept-live.ts`) turns a
   `report:*` metric key into display-ready strings (current period label +
   formatted value, prior period + signed delta) using the existing
   `getReportData` → `enumeratePeriods` → `computePeriodStatement` chain.
   The lesson page calls it server-side; the definition sheet calls it via
   a small `getConceptLive(conceptId)` server action only when opened on a
   completed concept. Slice A implements the `report:` namespace only
   (sufficient for Revenue — the only concept that can be Completed with
   live data this slice); `metric:`/`snapshot:`/`position:` keys return
   null and are picked up by Slices B/C as their concepts migrate.

| Concept | Classification |
|---|---|
| Revenue, Operating expenses, Cash flow, Free cash flow, Assets, Liabilities, Short-term obligations, Capital allocation | `standard_finance` |
| Savings rate, Net worth, Debt pressure, Financial flexibility, Retained cash, Liquidity | `household_adaptation` |
| Available capital | `pfi_metric` |

(Liquidity is classified `household_adaptation`, not `standard_finance`,
because its runway-in-months framing is PFI's household lens on a standard
liquidity concept, not the term used unmodified.)

## Schema (`src/lib/concepts/types.ts`)

```ts
export type ConceptClassification = "standard_finance" | "household_adaptation" | "pfi_metric";

export interface FormulaRow {
  label: string;
  operator?: "+" | "-" | "=";
  valueKey?: string;       // binds to a real figure, same namespace as PersonalApplication.metricKey
  staticValue?: string | number;
}

export interface ComparisonRow {
  label: string;
  included: boolean;       // true = counts toward the concept, false = doesn't
  explanation?: string;
}

export interface FinancialConcept {
  id: ConceptId;
  title: string;
  shortDefinition: string;                // terse tap-preview (Slice 2's pre-completion sheet default)
  plainEnglishSummary?: string;             // NEW — one strong sentence; sheet falls back to shortDefinition if absent
  classification: ConceptClassification;   // NEW
  memorableDistinction?: string;           // NEW
  whyItMatters: string;
  formula?: string;                        // accessible plain-text fallback; present whenever formulaRows is
  formulaRows?: FormulaRow[];              // NEW — structured statement-style block
  comparisonRows?: ComparisonRow[];        // NEW — included/excluded examples
  interpretation?: string;                 // NEW — what a change means/doesn't mean, in context
  householdAdaptation?: string;
  businessContext?: string;
  commonMisunderstanding?: string;
  whereUsed?: string[];                    // NEW — structured "where you'll see this" list
  relatedConceptIds: ConceptId[];
  prerequisiteConceptIds: ConceptId[];
  dataMetricKey?: string;
  status: "draft" | "published" | "archived";
  lesson?: Lesson;
}

export interface Module {
  id: string;
  title: string;
  order: number;
  conceptIds: ConceptId[];
}
```

`reinforcementPreview` (Lesson) is superseded by concept-level `whereUsed`
for migrated concepts, but stays in the type (as optional) — unmigrated
concepts still use it — until the final rollout slice retires it once every
concept has `whereUsed` populated. Sheet summary fallback chain for
unmigrated concepts: `plainEnglishSummary` when present; otherwise the sheet
shows `shortDefinition` + `fullDefinition` as today. Migrated concepts fold
anything essential from `fullDefinition` into `plainEnglishSummary`/
`whyItMatters`, and the sheet shows the summary alone.

```ts
export interface Lesson {
  opening: string;                  // household scenario, then names the standard term (was `intro`)
  standardTerm: string;
  whyItMattersExtended?: string;
  calculation?: { formula?: string; walkthrough: string };
                                    // formula is legacy-optional: unmigrated lessons keep their
                                    // strings; migrated concepts use concept.formulaRows instead
  genericExample: string;
  personalApplication?: PersonalApplication;
  commonMisunderstanding: string;
  knowledgeChecks: KnowledgeCheck[]; // renamed plural; each check gains a stable id
  completionSummary?: string;       // NEW — completion-card copy; generic fluency fallback when absent
  reinforcementPreview?: string;    // legacy; superseded by concept.whereUsed on migrated concepts
}

export interface KnowledgeCheck {
  id: string;                       // stable, e.g. "revenue-check-1" — persistence key
  kind: "interpretation" | "identify-figure" | "which-action";
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}
```

(Decision #7: no generic `sections` array — fixed named fields, mechanically
validatable. Decision #8: the optional/legacy fields above.)

`PersonalApplication` (unchanged from Slice 1):

```ts
export interface PersonalApplication {
  metricKey: string;   // "metric:<id>" | "report:<field>" | "snapshot:<field>" | "position:<fn>"
  interpretationRules: string;
  requiresData: DataRequirement[];
}
```

## Progress data model change

`academy_progress.check_responses` moves from `{checkIndex, choiceIndex}[]`
to `{checkId, choiceIndex}[]`. `validateCheckAnswer`/`appendCheckResponse`
(`src/lib/concepts/progress.ts`) take a `checkId: string` instead of a
numeric index; `answerKnowledgeCheck` (`src/app/actions/academy.ts`) and
`KnowledgeChecks.tsx` update accordingly. No DB migration is needed beyond
the shape change — `check_responses` is already an untyped jsonb column; no
existing row's shape is read by anything outside this slice's own code paths
being changed together.

## Definition sheet (`TermDefinitionSheet.tsx`)

Render order, all states:

1. Title + subtle classification label (standard finance term / household
   adaptation / PFI metric) — never a dominant badge. Immediately beneath,
   **un-gated** (shows at every state): `businessContext` when present — the
   short paragraph explaining the classification, e.g. Available Capital's
   "PFI metric — ...does not have one direct corporate-accounting
   equivalent, so PFI retains a distinct name." Absent for concepts that
   don't need this elaboration (most `standard_finance` concepts).
2. Plain-English summary (`plainEnglishSummary`, falls back to
   `shortDefinition` for concepts not yet migrated to the new field).
3. Why it matters (`whyItMatters`) — **un-gated**, shows at every state.
4. Formula — visual `FormulaBlock` when `formulaRows` present, else the
   existing mono-text `formula` string; `householdAdaptation` note beneath
   if present.
5. Where it appears (`whereUsed`, falls back to nothing if absent for
   not-yet-migrated concepts — never renders an empty heading).
6. Related concepts (existing pill-button pattern, unchanged).
7. Academy CTA — state-dependent: "Take the lesson" (not started) /
   "Continue lesson" (in progress) / "Review lesson" (completed). Glossary-
   only concepts get no CTA, unchanged from Slice 3.
8. **Completed only**: live personal-data block (current value, trend,
   driver) when `personalApplication` data resolves; nothing rendered if it
   doesn't (never a fake "unlocked" claim over absent data).

## Lesson page — the 11-part framework

Mapped onto the schema above, rendered in the existing scrollable Lesson tab
(no stepper, unchanged from Slice 3):

1. **Household opening** (`lesson.opening`) → names the standard term
   (`lesson.standardTerm`).
2. **Memorable distinction** (`concept.memorableDistinction`) in a visually
   prominent block, followed by the comparison rows (`concept.comparisonRows`)
   as a responsive stacked list on mobile, not a wide table.
3. **Plain-language meaning** — `LessonSection{kind:"meaning"}`, defaults to
   `concept.plainEnglishSummary` if no override body given.
4. **Why it matters** — `LessonSection{kind:"why-it-matters"}`, defaults to
   `concept.whyItMatters` + `lesson.whyItMattersExtended`.
5. **Visual calculation** — `FormulaBlock` from `concept.formulaRows`/
   `formula`, plus `lesson.calculation.walkthrough` narrative.
6. **Apply it to the household** — new `HouseholdApplication.tsx` component:
   resolves `lesson.personalApplication.metricKey` against real report/metric
   data when `requiresData` is satisfied, rendering current value/prior-
   period change/primary driver labeled "Calculated from your data"; falls
   back to `lesson.genericExample` labeled "Sample household" otherwise.
   Built standalone so it can migrate into a future "Your Data" tab without
   touching lesson content.
7. **Interpretation** (`concept.interpretation`) — what a change means and
   doesn't mean, in context; no "higher is always good" framing.
8. **Common misunderstanding** (`lesson.commonMisunderstanding`) in a
   visually distinct block.
9. **Where this appears in PFI** (`concept.whereUsed`) as a bulleted list.
10. **Knowledge checks** (`lesson.knowledgeChecks`) — unchanged interaction
    model (immediate feedback, correct answer marked, explanation always
    shown, completion regardless of correctness), now keyed by stable
    `checkId`.
11. **Completion** — revised card copy using `lesson.completionSummary`
    ("Lesson complete — you can now recognize Revenue throughout PFI...").
    Actions: **Review concept** (opens the term sheet), **Back to Academy**
    (existing), **Next concept** (`adjacentLessons.next`, existing pager
    logic, surfaced as a completion action too — user remains free to
    navigate elsewhere; "next" is a suggestion, not a requirement).

## Shared components (new)

- `FormulaBlock` — statement-style calculation (line items, operators,
  totals), accessible to screen readers via the existing `formula` string as
  a text alternative. Used by both the lesson's calculation section and the
  definition sheet's formula section — one component, two call sites.
- `ComparisonRows` — responsive included/excluded list (stacked rows on
  mobile, not a wide HTML table). Used by the lesson's memorable-distinction
  section.
- `ClassificationLabel` — subtle text label, three values.
- `WhereUsedList` — compact bulleted list, shared by sheet and lesson.

## Content: Revenue (reference lesson)

Full rewrite of `src/lib/concepts/content/revenue.ts` per the 11-part
framework above. Household opening ("Every household has money entering
from outside sources..."), memorable distinction ("Not every deposit is
Revenue"), comparison rows (paycheck/side-income yes; savings transfer, loan
proceeds, refund no), live household application via
`personalApplication.metricKey = "report:revenue"`, interpretation ("Revenue
can rise while free cash flow falls if operating expenses rise faster"),
common misunderstanding (the savings-transfer example), `whereUsed` (household
statement, management commentary, free cash flow calc, savings-rate calc,
"what moved your line", forecasting inputs).

## Content: Available Capital (reference definition sheet)

Full rewrite of `src/lib/concepts/content/available-capital.ts` — glossary-
only, no lesson. Classification `pfi_metric`. Plain-English summary, why it
matters (cash existing vs. genuinely free to use), `formulaRows` for
`Liquid assets − Revolving balances − Near-term obligations = Available
Capital`, `whereUsed` (home dashboard, Personal Index, Baseline, Waterline,
forecasting, financial-condition analysis), related concepts (liquidity,
short-term obligations, financial flexibility). The internal "audit ruling,
spec findings #6" language is removed from `householdAdaptation` and replaced
with the plain product explanation of why the metric has its own name (no
direct corporate-accounting equivalent).

## Testing

Unit: schema/registry validation extended for the new required
`classification`/`plainEnglishSummary` fields (all 15 concepts) and stable
`checkId` uniqueness within a lesson; `content.test.ts` extended for Revenue
and Available Capital's new fields; `HouseholdApplication`'s real-data vs.
sample-fallback branches (with data, partial data, no data); `FormulaBlock`/
`ComparisonRows` render correctly and accessibly.

e2e: Revenue lesson renders all 11 sections in order; a check answered wrong
still completes the lesson and persists by `checkId`; Available Capital's
sheet shows the un-gated `whyItMatters` before any lesson interaction (N/A
here since it's glossary-only, but confirms the un-gating applies uniformly);
no internal engineering language renders anywhere in the two reference
concepts' output; classification label renders correctly for all three
values across the 15 concepts; related-concept navigation still works.

## Files

Modified: `src/lib/concepts/types.ts`, `src/lib/concepts/registry.ts`
(validation), `src/lib/concepts/content/revenue.ts`,
`src/lib/concepts/content/available-capital.ts`, all 13 other content files
(classification field only), `src/lib/concepts/progress.ts`,
`src/app/actions/academy.ts`, `src/components/academy/KnowledgeChecks.tsx`,
`src/components/academy/LessonSections.tsx` (or split per the new section
model), `src/components/concepts/TermDefinitionSheet.tsx`,
`src/lib/concepts/term-sheet.ts` (un-gating, new fields).

New: `src/components/academy/HouseholdApplication.tsx`; shared components
`FormulaBlock`, `ComparisonRows`, `ClassificationLabel`, `WhereUsedList` in
`src/components/concepts/` — that directory already serves as the shared
term-presentation layer (`FinancialTerm`, `TermSheetProvider`,
`TermDefinitionSheet`) consumed by both the definition sheet and Academy.

Unchanged: `academy_progress` table shape (only the jsonb payload shape
changes, not the column), RLS policies, routes, nav, `Sheet` primitive,
`TermSheetProvider`'s stack API, server-action conventions.
