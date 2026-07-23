# Academy content refinement — Slice C: roll the pattern out to the 4 remaining definition sheets

**Date:** 2026-07-23
**Status:** Approved (brainstorm decisions recorded below)
**Depends on:** Slice A (schema extension + Revenue/Available Capital reference implementations, PR #23), Slice B (9-lesson migration + resolver extension, PR #32)

## Purpose

Slice A validated the refined Academy content framework on two reference
concepts — Revenue (a full lesson) and Available Capital (a glossary-only
definition sheet). Slice B propagated the **lesson** pattern to the 9 remaining
lessons. Slice C is the last content slice: it propagates the **definition-sheet**
pattern (Available Capital as the reference) to the 4 remaining glossary-only
concepts, so every tappable term in PFI reads as a plain-English definition
sheet with a "Where it appears" list — never as raw internal documentation.

This slice is **content authoring only**. No schema, component, registry, route,
nav, progress-model, or resolver changes. Every field it adds already exists in
the type system, has a rendering component, and has a `content.test.ts`
guardrail from Slice A.

## Scope

### The 4 glossary-only concepts (everything without a `lesson:` except the migrated reference)

The registry holds 16 concepts; 11 carry lessons (migrated by Slices A/B and
Spec 2). Of the 5 glossary-only records, `available-capital` was the Slice A
reference. The remaining **4**, all in Module 3 "Financial Pressure and
Flexibility":

| Concept | Classification | `dataMetricKey` |
|---|---|---|
| short-term-obligations | standard_finance | `snapshot:nearTermObligations` |
| financial-flexibility | household_adaptation | `position:cushion` |
| retained-cash | household_adaptation | `report:savings` |
| capital-allocation | standard_finance | (none) |

The "13 definition sheets" phrasing in earlier docs was Slice-A-era framing (15
concepts then − 2 reference = 13 remaining *content files*, which turned out to
be 9 lessons → Slice B plus these 4 sheets → Slice C). The real Slice C
remainder is 4.

### What the definition sheet actually renders (drives the field set)

The sheet's view model (`src/lib/concepts/term-sheet.ts`) maps only:
`classification`, `plainEnglishSummary` (falls back to `shortDefinition`;
suppresses the raw `fullDefinition` block when present), `whyItMatters`,
`businessContext`, `formulaRows` + `formula`, `householdAdaptation`,
`whereUsed`, and a completed-only live "Your data" block. It does **not** render
`memorableDistinction`, `comparisonRows`, or `interpretation` — those are
lesson-only fields. So this slice authors only the fields the sheet shows.

## Decisions from this brainstorm (2026-07-23)

1. **Content-only — no resolver or framework changes.** The docs scope Slice C
   as "content only," and the reference sheet (Available Capital,
   `position:availablePosition`) itself renders no live block because `position:`
   isn't resolved. So this slice adds no resolver support. A live "Your data"
   block appears only for `retained-cash`, whose `report:savings` key the Slice A
   resolver already handles. `short-term-obligations` (`snapshot:nearTermObligations`
   — the snapshot resolver is `netWorth`-only), `financial-flexibility`
   (`position:cushion`), and `capital-allocation` (no metric) stay purely
   definitional, exactly like Available Capital. A future "resolver-completion"
   slice can wire the remaining namespaces if desired.
2. **Author only the fields the definition sheet renders** (rendered-fields-only,
   YAGNI). Each concept gains `plainEnglishSummary`, `whereUsed`, and
   `formulaRows` + `formula` *where a genuine equation exists*. No
   `memorableDistinction`/`comparisonRows`/`interpretation` — they don't render
   on a glossary sheet and would be dead data unless the concept is later
   promoted to a lesson.
3. **`fullDefinition` stays in the data.** The `content.test.ts` "keeps
   glossary-only records lesson-free but tappable" test asserts both
   `shortDefinition` and `fullDefinition` are truthy for these 4 (+
   available-capital). The view model simply stops rendering `fullDefinition`
   once `plainEnglishSummary` is present — the field remains in the source.
4. **`formulaRows` only where a real multi-term equation exists** — grounded in
   the actual engine, not invented:
   - `retained-cash`: `Free cash flow − Investment contributions − Debt reduction
     = Retained cash` — matches `report.ts`'s own allocation narration
     ("free cash flow was allocated across … retained cash, … investment
     contributions, and … debt reduction").
   - `financial-flexibility`: `Available capital − Financial waterline = Cushion`
     — matches `position.ts` (`cushion = availablePosition − waterline`).
   - `short-term-obligations`: **no** `formulaRows` — it is a raw input
     (`nearTermObligations`, the sum of payments due before next income), a
     component of Available Capital rather than its own computed equation.
   - `capital-allocation`: **no** `formulaRows` — a decision concept, no
     arithmetic.
5. **`whereUsed` lists reference real, grounded surfaces only** (the validator
   rejects empty entries but does not verify surfaces; accuracy is on the
   author):
   - `retained-cash`: Report "Savings (retained cash)" row (under "Allocated to");
     Savings rate. (`ReportView.tsx:127`, `:134`)
   - `financial-flexibility`: Home dashboard "Cushion" card.
     (`HomeDashboard.tsx:221`)
   - `short-term-obligations`: Home dashboard "Obligations" card; Available
     capital (subtracted in its calculation). (`HomeDashboard.tsx:212`)
   - `capital-allocation`: Report "Allocated to" breakdown, under Free cash flow.
     (`ReportView.tsx:126`) — note this concept is not currently wired as a
     tappable `FinancialTerm` anywhere; it is reached from the Academy Module 3
     list, and `whereUsed` names where the *idea* is visible.
6. **Single Slice C branch/PR**, authored in one pass. Four short glossary sheets
   against a proven reference (Available Capital) is tractable without fan-out.

## Part 1 — Per-concept content migration

Each concept is rewritten against the Available Capital reference
(`src/lib/concepts/content/available-capital.ts`) with no structural change.
Existing correct fields (`shortDefinition`, `fullDefinition`, `whyItMatters`,
`businessContext`, `commonMisunderstanding`, `relatedConceptIds`,
`prerequisiteConceptIds`, `dataMetricKey`, `classification`, `status`) are
preserved; classifications are locked by `content.test.ts` and already correct.

### short-term-obligations (standard_finance, `snapshot:nearTermObligations`)

- **Add** `plainEnglishSummary` — the payments already committed before the next
  expected income; a slice of total liabilities, not the whole balance.
- **Add** `whereUsed`: Home dashboard "Obligations" card; Available capital.
- **No** `formulaRows` (raw component).
- **Keep** the existing `commonMisunderstanding` ("money in an account isn't
  automatically available").
- **Live block:** none (`snapshot:` resolver is `netWorth`-only).

### financial-flexibility (household_adaptation, `position:cushion`)

- **Add** `plainEnglishSummary` — the room to absorb a surprise or seize an
  opportunity without borrowing.
- **Add** `formulaRows` + `formula`: `Available capital − Financial waterline
  = Cushion`.
- **Add** `householdAdaptation` — a short note that PFI quantifies flexibility as
  the **cushion** above the financial waterline (bridging the qualitative idea to
  the dashboard's "Cushion" figure).
- **Add** `whereUsed`: Home dashboard "Cushion" card.
- **Live block:** none (`position:` not resolved — matches Available Capital).

### retained-cash (household_adaptation, `report:savings`)

- **Add** `plainEnglishSummary` — the slice of free cash flow the household kept
  as cash rather than investing or paying down debt; the numerator of savings
  rate.
- **Add** `formulaRows` + `formula`: `Free cash flow − Investment contributions
  − Debt reduction = Retained cash`.
- **Add** `whereUsed`: Report "Savings (retained cash)" row; Savings rate.
- **Live block:** **renders** — `report:savings` is already resolved by the
  Slice A resolver. Verify it shows a real figure against a demo profile.

### capital-allocation (standard_finance, no metric)

- **Add** `plainEnglishSummary` — the decision about where free cash flow goes
  (cash, investments, or debt paydown); the same dollar can only go one place.
- **Add** `whereUsed`: Report "Allocated to" breakdown, under Free cash flow.
- **No** `formulaRows` (decision concept, no arithmetic).
- **Keep** the existing `businessContext` (a CEO's capital-allocation job at
  household scale).
- **Live block:** none (no `dataMetricKey`).

## Part 2 — Testing & verification

- **Registry validation (automatic).** `content.test.ts` already runs
  `validateRegistry`, which enforces: `formulaRows` requires the plain-text
  `formula` fallback; `whereUsed` rejects empty entries; classifications match
  the assignment table; no internal-engineering language
  (`/audit ruling/`, `/spec finding/`, `/task \d/`, `/decisions #/`,
  `/implementation plan/`) appears in any serialized concept. Authoring must
  satisfy all of these.
- **New unit assertion** (`content.test.ts`): the 4 Slice C concepts now carry a
  non-empty `plainEnglishSummary` and a non-empty `whereUsed`, mirroring how
  Slices A/B added coverage as concepts migrated. The existing "keeps
  glossary-only records lesson-free but tappable" and "has exactly 16 concepts,
  11 with lessons" invariants stay green (no lessons added).
- **e2e** — strengthen the existing `e2e/academy.spec.ts` "glossary-only row
  opens the definition sheet" test (already opens **Short-term obligations**) to
  also assert the new "Where it appears" section renders, proving the migration
  on a live glossary sheet. Do not rewrite the suite.
- **Live browser QA** — `pnpm check` green, then **390×844 first, then
  1280×900**, with a loaded demo profile:
  - `retained-cash` sheet shows the new plain-English summary, the
    `Free cash flow − … = Retained cash` formula block, "Where it appears," and a
    live "Your data" block with a real figure.
  - `short-term-obligations`, `financial-flexibility`, `capital-allocation`
    sheets show the new summary + "Where it appears" (and, for
    financial-flexibility, the cushion formula block) with **no** live block —
    confirming the content-only boundary.
  - No horizontal overflow at 390px
    (`document.documentElement.scrollWidth === clientWidth`); zero console errors
    on every sheet at both viewports.

## Files

**Modified (content):** `src/lib/concepts/content/short-term-obligations.ts`,
`financial-flexibility.ts`, `retained-cash.ts`, `capital-allocation.ts`.

**Modified (tests):** `src/lib/concepts/content.test.ts` (add the
plainEnglishSummary/whereUsed assertion for the 4), `e2e/academy.spec.ts`
(strengthen the existing glossary-sheet test).

**Modified (docs):** `docs/DECISIONS.md` (record the content-only Slice C
decision + the deferred resolver-completion note), `docs/CURRENT_PHASE.md`,
`docs/KNOWN_LIMITATIONS.md` (record the deferred `snapshot:`/`position:`
resolver support so the three sheets without live blocks are documented, not
hidden).

**Unchanged:** `src/lib/concepts/types.ts`, `registry.ts`, `modules.ts`,
`src/lib/data/concept-live.ts` (**no resolver change**), all shared components
(`FormulaBlock`, `WhereUsedList`, `ClassificationLabel`, `TermDefinitionSheet`,
`term-sheet.ts`), routes, nav, `academy_progress` table/RLS, progress model,
server actions.

## Explicitly out of scope

- **Resolver extension** for `snapshot:nearTermObligations`, `position:cushion`,
  and `position:availablePosition` — a possible later "resolver-completion" slice
  that would let short-term-obligations, financial-flexibility, and
  available-capital render live blocks too. Recorded in KNOWN_LIMITATIONS.
- **Academy Slice 4** — personalization/reinforcement rendering of
  `personalApplication` plus lesson-start/completion analytics events.
- **Lesson-only fields** (`memorableDistinction`, `comparisonRows`,
  `interpretation`) on these glossary concepts — they don't render on a
  definition sheet.
- Any change to the definition-sheet **rendering** — Slice A's components already
  render every field this slice populates.
