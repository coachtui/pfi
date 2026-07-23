# Academy content refinement — Slice B: roll the pattern out to the 9 remaining lessons

**Date:** 2026-07-23
**Status:** Approved (brainstorm decisions recorded below)
**Depends on:** Slice A (schema extension + Revenue/Available Capital reference implementations, PR #23), Slice 3 (Academy home/lesson/progress, PR #22), Spec 2 (score-index-divergence lesson, PR #29 — already authored against the new schema)

## Purpose

Slice A validated the refined Academy content framework on two reference
concepts — Revenue (a full lesson) and Available Capital (a glossary-only
definition sheet) — plus the schema and shared components both depend on.
Slice B propagates the **lesson** pattern to the 9 remaining lessons so every
lesson teaches through a household situation, carries a memorable
distinction with included/excluded examples, shows a statement-style
calculation, and — where a metric binding exists — applies the concept to the
user's real household data.

This slice is **content authoring plus one bounded engine extension**: the
`concept-live` resolver, which Slice A built for the `report:` namespace only,
gains `metric:` and `snapshot:` support so 4 more lessons render live figures
instead of a sample household. No schema, component, registry, route, nav, or
progress-model changes.

## Scope

### The 9 lessons (everything with a `lesson:` except the two already migrated)

11 concepts carry lessons. `revenue` (Slice A) and `score-index-divergence`
(Spec 2, authored fresh against the new schema) already have
`memorableDistinction`/`formulaRows`/etc. The remaining **9**:

| Module | Lessons |
|---|---|
| 1 — How Your Household Operates | operating-expenses, cash-flow, free-cash-flow, savings-rate |
| 2 — Reading Your Household Balance Sheet | assets, liabilities, net-worth, liquidity |
| 3 — Financial Pressure and Flexibility | debt-pressure |

(Module 3's other four concepts and Available Capital are glossary-only — they
belong to Slice C, not this slice.)

### Live-data status after Slice B

| Lesson | `personalApplication.metricKey` | Live "Applied to your household" |
|---|---|---|
| operating-expenses | `report:operatingExpenses` | ✅ already live (Slice A resolver) |
| free-cash-flow | `report:freeCashFlow` | ✅ already live |
| savings-rate | `report:savingsRatePct` | ✅ already live |
| cash-flow | `metric:recurring_surplus` | ✅ live via resolver extension |
| liquidity | `metric:liquid_runway_months` | ✅ live via resolver extension |
| debt-pressure | `metric:debt_service_ratio` | ✅ live via resolver extension |
| net-worth | `snapshot:netWorth` | ✅ live via resolver extension |
| assets | (none) | Sample household — by design |
| liabilities | (none) | Sample household — by design |

`assets` and `liabilities` are whole-balance-sheet concepts, not a single
figure; they have no `personalApplication` binding and correctly render only
the labeled sample household. This is intentional, not a gap.

## Decisions from this brainstorm (2026-07-23)

1. **Extend the resolver to `metric:` and `snapshot:` now** (not deferred to a
   later slice). The Academy's core promise is "learn the concept → apply it
   to *your* household"; leaving 4 of 9 lessons showing only a sample
   household would hollow that promise. Slice A's spec decision #10 explicitly
   anticipated `metric:`/`snapshot:`/`position:` support being added "by
   Slices B/C as their concepts migrate." `position:` is **not** needed by any
   Slice B lesson and is left unimplemented (a Slice C concern if ever).
2. **Resolver framing stays value-neutral.** The resolver emits only *current
   value / prior value / signed delta*, never a good/bad judgment. This is
   load-bearing for debt-pressure and operating-expenses, where **lower** is
   better — encoding "higher is good" would violate the binding product rule.
   Direction-of-good meaning lives entirely in each lesson's `interpretation`
   field.
3. **Single Slice B branch/PR**, matching the spec's "Slice B = the remaining
   9 lessons." Tasks ordered resolver-first so live-data QA is possible while
   authoring the lessons.
4. **Lessons authored sequentially, not fanned out to subagents.** Teaching-
   voice consistency across financial content matters more than parallelism;
   9 lessons against a proven template (Revenue) is tractable in one pass.
5. **No schema / component / registry / progress changes.** Every field this
   slice adds already exists in the type system and has a rendering component
   and a `content.test.ts` guardrail from Slice A. `lesson.reinforcementPreview`
   is retired per-lesson in favor of concept-level `whereUsed` (the renderer
   already prefers `whereUsed` when present); the field stays in the type
   until Slice C retires the last glossary user.

## Part 1 — Resolver extension (`src/lib/data/concept-live.ts`)

The only non-content engineering. Preserves the existing pure/impure split:
pure resolver functions stay unit-testable; the `server-only` `queries` import
stays a dynamic import inside the async fetch wrapper.

### New pure functions

- **`computeMetricLive(metricKey, snapshots, transactions, accounts, asOfCurrent, asOfPrior)`**
  → `ConceptLiveData | null`. For `metric:recurring_surplus |
  liquid_runway_months | debt_service_ratio`:
  - `buildMetricInputs(snapshots, transactions, accounts, asOf)` then
    `computeMetrics(inputs)` at the current period end and the prior period
    end; pick the `MetricResult` by id.
  - Format both values with **that metric's own `format` fn** (from the
    `METRICS` registry) so months render "0.4 mo", ratios "0.03", percentages
    "34%". The delta magnitude uses the same formatter.
  - Return `null` when the metric result is `unavailable`/`notApplicable`, the
    metric id is unknown, or there are no snapshots. Missing prior → non-null
    result with `deltaDisplay: null` (mirrors `computeReportLive`).
- **`computeSnapshotLive(metricKey, snapshots, asOfCurrent, asOfPrior)`** →
  `ConceptLiveData | null`. For `snapshot:netWorth`: current = the period-end
  snapshot's `netWorth`, prior = the prior period-end snapshot's; format as
  dollars (`formatDollars`); signed delta. `null` when no snapshots.

Period boundaries reuse the same `enumeratePeriods` / `latestCompletePeriod`
chain `computeReportLive` already uses, so all three namespaces compare "latest
complete month vs. the month before" consistently. The `asOf` dates for
metric/snapshot resolution are those period-end dates.

### Dispatcher + fetch wrapper

- A small internal dispatch in `getConceptLiveData` picks by namespace prefix
  (`report:` → existing path; `metric:` → load `accounts` too; `snapshot:` →
  snapshots suffice).
- The `metric:` path additionally needs `financial_accounts` — reuse the
  existing `fetchScoreSources(supabase)` loader (→ `ScoreSourceRows`, already
  used by `getScoreSummary`/`getScoreData`) rather than adding a new query.
  Computing a metric at an arbitrary `asOf` is already an established pattern:
  `getScoreData` calls `breakdownAt(sources, addDays(asOf, -30))` for score
  momentum, so a current-vs-prior-period-end metric read is the same shape
  applied to a single `MetricResult` instead of the whole score.
- `ConceptLiveData` is unchanged (all display fields are already formatted
  strings; the metric/snapshot formatters just produce different units).

### Resolver tests (`concept-live.test.ts`, extend existing)

Pure-function coverage over in-memory data:
- `metric:` for each unit type — months (`liquid_runway_months`), ratio/pct
  (`debt_service_ratio`), dollars (`recurring_surplus`) — asserting the
  metric's own formatter is applied and the signed delta reads correctly.
- `snapshot:netWorth` in dollars with a prior period.
- Unavailable metric → `null` (→ sample fallback).
- Single-period (no prior) → non-null value, `deltaDisplay: null`.
- Unknown namespace/field → `null` (unchanged guarantee).

## Part 2 — Per-lesson content migration

Each of the 9 lessons is rewritten against the Revenue reference
(`src/lib/concepts/content/revenue.ts`), gaining these fields with no
structural change:

- **`plainEnglishSummary`** — one strong sentence; folds anything essential
  from `fullDefinition` so the sheet can show the summary alone.
- **`memorableDistinction`** — the lesson's one retained takeaway (Revenue:
  "Not every deposit is revenue.").
- **`formulaRows`** — structured statement-style calculation; the existing
  `formula` string is kept as the required plain-text / screen-reader
  fallback. Rows use `staticValue` sample figures (labeled "Sample figures" by
  the renderer) or `valueKey` bindings where a live figure is appropriate.
- **`comparisonRows`** — included/excluded examples supporting the memorable
  distinction, marked with check/x **and text** (never color alone).
- **`interpretation`** — what an increase/decrease means *and doesn't* mean in
  context; never "higher is always good." Carries the direction-of-good
  meaning the value-neutral resolver deliberately omits.
- **`whereUsed`** — concept-level list of PFI surfaces where the concept
  appears; the lesson's legacy `reinforcementPreview` is removed.
- **`completionSummary`** — fluency-framed completion-card copy (no
  "unlocked"/"analytical depth" language), naming the concept and how it
  connects to neighbors.

`personalApplication` bindings are already present and correct on all seven
metric-bound lessons — unchanged. `assets`/`liabilities` remain without a
binding (sample household only).

### Per-lesson authoring notes (the genuine content decisions)

- **operating-expenses** — distinction: an allocation (savings/investment/
  extra principal) is *not* an operating cost. Comparison rows already exist
  in prose; structure them. Interpretation: rising OpEx isn't automatically
  bad, but it shrinks free cash flow when revenue is flat — **lower is
  generally healthier**, stated without blame.
- **cash-flow** — distinguish the *movement* of money (in vs. out over a
  period) from a point-in-time balance. Binds to `metric:recurring_surplus`
  ("Typical monthly free cash flow").
- **free-cash-flow** — distinction: what you *keep*, not what you *make*
  (revenue). Already `report:`-live.
- **savings-rate** — PFI's retained-cash ÷ revenue definition vs. the looser
  popular "(income − spending) ÷ income"; already flagged in existing content.
  Already `report:`-live.
- **assets** — distinction: what the household *owns* (vs. liabilities, what it
  owes). No single-figure binding; sample household.
- **liabilities** — mirror of assets; distinction: an obligation to pay is not
  the same as a monthly expense. Sample household.
- **net-worth** — distinction: owned-minus-owed, a *stock* not a *flow*; can
  rise from market appreciation vs. owner-created equity (keep those distinct
  per the binding rule). Binds to `snapshot:netWorth`.
- **liquidity** — distinction: *access to cash now* vs. being wealthy on paper;
  runway-in-months framing (household adaptation). Binds to
  `metric:liquid_runway_months`. Interpretation: more runway = more resilience,
  but stated as resilience not virtue.
- **debt-pressure** — distinction: the *burden* of debt service relative to
  income, not the debt balance itself. Binds to `metric:debt_service_ratio`
  — **lower is better**; interpretation must make that explicit so the neutral
  delta isn't misread.

## Part 3 — Testing & verification

- **Unit** — the resolver tests above. Content stays covered by the existing
  `content.test.ts` guardrails (classification assignment, "sample" labeling in
  every `genericExample`, no internal-engineering language, lesson presence per
  module) — all already green and unchanged by this slice.
- **e2e** — extend `e2e/academy.spec.ts` **in place** for one migrated
  non-Revenue lesson: assert the memorable-distinction callout, comparison
  rows, and (for a `metric:`/`snapshot:` lesson against a loaded demo profile)
  a "Calculated from your data" block. Do not rewrite the suite.
- **Live browser QA** — `pnpm check` green, then **390×844 first, then
  1280×900**: spot-check lessons spanning the namespaces — one `report:`
  (e.g. free-cash-flow), one `metric:` (e.g. liquidity or debt-pressure), the
  `snapshot:` net-worth lesson, and one sample-only (assets) — confirming live
  figures render for a demo profile, comparison rows read without color-alone,
  no horizontal overflow at 390px, and zero console errors.

## Files

**Modified (content):** `src/lib/concepts/content/operating-expenses.ts`,
`cash-flow.ts`, `free-cash-flow.ts`, `savings-rate.ts`, `assets.ts`,
`liabilities.ts`, `net-worth.ts`, `liquidity.ts`, `debt-pressure.ts`.

**Modified (engine):** `src/lib/data/concept-live.ts` (metric/snapshot
resolvers + dispatcher + widened fetch wrapper), `src/lib/data/concept-live.test.ts`.

**Modified (tests/docs):** `e2e/academy.spec.ts`, `docs/DECISIONS.md`
(record the resolver-extension decision), `docs/CURRENT_PHASE.md`,
`docs/KNOWN_LIMITATIONS.md` (only if any lesson defers something).

**Unchanged:** `src/lib/concepts/types.ts`, `registry.ts`, all shared
components (`FormulaBlock`, `ComparisonRows`, `ClassificationLabel`,
`WhereUsedList`, `HouseholdApplication`, `TermDefinitionSheet`), routes, nav,
`academy_progress` table/RLS, progress model, server actions.

## Explicitly out of scope

- Slice C (the remaining 13 definition sheets).
- The `position:` resolver namespace (no Slice B lesson needs it).
- Any change to the lesson-page or definition-sheet **rendering** — Slice A's
  components already render every field this slice populates.
- The reserved third "Your Data" lesson tab (separate future work).
