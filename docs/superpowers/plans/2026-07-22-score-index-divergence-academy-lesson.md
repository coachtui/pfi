# Score/Index Divergence Academy Lesson Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author a full Academy concept/lesson ("PFI vs Fundamentals Score") explaining why the dashboard's PFI index and Fundamentals Score can move in opposite directions, and repoint the dashboard divergence line's `› Learn` control from its interim inline-text expand to this real lesson.

**Architecture:** Adds one new `FinancialConcept` record (with a `lesson`) to the existing, framework-free Academy content system (`src/lib/concepts/`) plus a new fourth `Module` to hold it, following the exact data shape and conventions the other 15 concepts already use — no new components, routes, or infrastructure. `DivergenceExplainer.tsx` swaps its local expand/collapse state for a `next/link` to the new lesson's route.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest, Playwright (existing `e2e/academy.spec.ts`).

## Global Constraints

- Every score/index must be explainable ("How is this calculated?" always answerable) — satisfied by the lesson itself; no new formula is introduced.
- Mobile-first: visually verify at ~390px, then desktop, before declaring UI work complete.
- Never communicate positive/negative state through color alone — n/a to this change (no new state indicators).
- `pnpm check` (lint + typecheck + test + build) must be green before completion.
- Record significant architecture/product decisions in `docs/DECISIONS.md`; update `docs/CURRENT_PHASE.md` after the session.

## Plan-time corrections to the approved design spec

Two details in `docs/superpowers/specs/2026-07-22-score-index-divergence-academy-lesson-design.md` don't survive contact with the existing code and are corrected here (behavior for the end user is unchanged — the lesson still ships sample-only either way):

1. **No `dataMetricKey: "signal:divergence"`.** `src/lib/concepts/engine-binding.test.ts` asserts every authored `dataMetricKey` / `personalApplication.metricKey` resolves against a real engine namespace it derives from the live `financial-engine` code (`metric:`, `report:`, `snapshot:`, `position:` only — see `resolves()` in that file). There is no `signal:` namespace, so authoring one would fail that test immediately. The new concept ships with **no `dataMetricKey` and no `lesson.personalApplication`** — `LessonPage` (`src/app/academy/[conceptId]/page.tsx:26`) already handles this by passing `live: null` to `LessonView` whenever `personalApplication` is absent, which `HouseholdApplication` already renders as the generic/sample path. This is the same visible outcome the spec wanted; it's just not pre-wired to a not-yet-existent resolver.
2. **No new component test file.** The spec's testing plan mentioned a "`DivergenceExplainer` component test." This codebase has no `*.test.tsx` files anywhere (`find src/components -iname "*.test.tsx"` returns nothing) — component-level behavior here is verified through `pnpm typecheck`/`pnpm build` plus live browser visual QA, not unit tests. Task 3 below follows that existing convention instead of introducing a new one.
3. **New optional `Lesson.openingHeading` field.** `LessonSections.tsx` auto-derives the first section's heading as `` `What is ${concept.title.toLowerCase()}?` ``. Every existing lesson has a plain-noun title, so that reads fine ("What is revenue?"), but this concept's title is `"PFI vs Fundamentals Score"` — lowercasing it yields "What is pfi vs fundamentals score?", which mangles the acronym. Rather than lowercase-mangle an acronym or special-case the renderer with a heuristic, Task 1 adds an optional `openingHeading?: string` override to the `Lesson` interface (additive, backward-compatible — all 10 existing lessons omit it and render exactly as before) and sets it to `"What is a divergence?"` on the new concept. This keeps the "What is …?" cadence the other lessons use while sidestepping the acronym problem.

---

### Task 1: Author the `score-index-divergence` concept and its module

**Files:**
- Modify: `src/lib/concepts/types.ts` (add optional `Lesson.openingHeading`)
- Create: `src/lib/concepts/content/score-index-divergence.ts`
- Modify: `src/lib/concepts/content/index.ts`
- Modify: `src/lib/concepts/modules.ts`
- Modify: `src/components/academy/LessonSections.tsx` (honor `openingHeading`)
- Modify: `src/lib/concepts/content.test.ts`
- Modify: `src/lib/concepts/progress.test.ts`

**Interfaces:**
- Produces: `scoreIndexDivergence: FinancialConcept` (id `"score-index-divergence"`), exported from `src/lib/concepts/content/score-index-divergence.ts`. Task 3 consumes only its `id` (as a literal string in a route href — no import needed there).
- Produces: `Lesson.openingHeading?: string` — a new optional field on the existing `Lesson` interface; when set, overrides the auto-derived `What is <title>?` first-section heading. All existing lessons omit it (unchanged behavior).
- Consumes: `FinancialConcept`/`Module`/`Lesson` types from `../types` (adding one optional field; no existing field changes).

- [ ] **Step 1: Add the optional `openingHeading` field to the `Lesson` interface**

In `src/lib/concepts/types.ts`, the `Lesson` interface currently begins:

```ts
export interface Lesson {
  opening: string;                    // 1. household scenario, then names the standard term
  standardTerm: string;               // 2.
```

Add the optional override immediately after `opening`:

```ts
export interface Lesson {
  opening: string;                    // 1. household scenario, then names the standard term
  /** Overrides the auto-derived "What is <title>?" heading for the opening section. */
  openingHeading?: string;
  standardTerm: string;               // 2.
```

- [ ] **Step 2: Honor `openingHeading` in `LessonSections`**

In `src/components/academy/LessonSections.tsx`, the first entry of the `sections` array currently reads:

```tsx
    { title: `What is ${concept.title.toLowerCase()}?`, body: <p>{lesson.opening}</p> },
```

Change it to prefer the override when present:

```tsx
    { title: lesson.openingHeading ?? `What is ${concept.title.toLowerCase()}?`, body: <p>{lesson.opening}</p> },
```

- [ ] **Step 3: Write the new concept content file**

Create `src/lib/concepts/content/score-index-divergence.ts`:

```ts
// src/lib/concepts/content/score-index-divergence.ts
import type { FinancialConcept } from "../types";

export const scoreIndexDivergence: FinancialConcept = {
  id: "score-index-divergence",
  title: "PFI vs Fundamentals Score",
  classification: "pfi_metric",
  shortDefinition:
    "PFI and your Fundamentals Score can move in opposite directions on the same day — they track different time horizons, not different opinions.",
  plainEnglishSummary:
    "PFI reacts to what happened today; your Fundamentals Score reflects the last 90 days. A short-term cash swing can move one without moving the other.",
  memorableDistinction: "PFI reacts today; the Fundamentals Score remembers the last 90 days.",
  fullDefinition:
    "PFI behaves like a daily share price: it reacts to recent cash movement, including one-time swings. The Fundamentals Score is a 90-day financial-health rating built from steadier patterns like liquidity and debt pressure. Because they measure different things over different windows, they can disagree on any given day without either one being wrong.",
  whyItMatters:
    "Without this distinction, a single large expense can look like a crisis, or a single good day can look like lasting progress. Knowing PFI and the Fundamentals Score answer different questions keeps a short-term swing from being mistaken for a real change in your household's underlying health.",
  businessContext:
    "Traders use the word \"divergence\" for exactly this pattern: when a price and an underlying indicator move in different directions, it's often read as a sign that a headline move doesn't match the underlying trend — not that either measurement is broken.",
  whereUsed: ["Home dashboard's divergence explainer line"],
  relatedConceptIds: ["cash-flow", "liquidity"],
  prerequisiteConceptIds: [],
  status: "published",
  lesson: {
    openingHeading: "What is a divergence?",
    opening:
      "You pay a large bill and watch PFI drop that same day. But your Fundamentals Score doesn't move — it might even keep improving. Which one is telling the truth? Both. They're just answering different questions.",
    standardTerm:
      "In investing, \"divergence\" describes a price and an indicator moving in different directions — a classic signal that a headline number and the underlying trend aren't saying the same thing. PFI vs. Fundamentals Score is that same pattern, applied to your household.",
    whyItMattersExtended:
      "PFI is built to react — it's the number that shows you today's cash movement. The Fundamentals Score is built to hold steady — it only shifts when your underlying pattern, not a single day, actually changes. Reading a divergence correctly means checking which number is answering the question you're actually asking.",
    genericExample:
      "Sample household: the Rivera household pays a $1,200 annual insurance premium in one day. PFI drops several points that same day, because it reacts to the cash leaving the account. Their Fundamentals Score doesn't move, because their spending and saving pattern over the last 90 days hasn't actually changed — one payment isn't a trend.",
    commonMisunderstanding:
      "It can feel like the two numbers are contradicting each other, or that one of them must be wrong. They're not disagreeing — PFI is answering \"what happened today\" and the Fundamentals Score is answering \"how healthy is my household overall, over the last 90 days.\" Different questions can have different answers on the same day.",
    knowledgeChecks: [
      {
        id: "score-index-divergence-check-1",
        kind: "interpretation",
        prompt:
          "Your PFI drops 4 points today after a large one-time payment, but your Fundamentals Score keeps improving. What's the best read?",
        choices: [
          "They track different time horizons, so this is expected",
          "The Fundamentals Score must be wrong",
          "This means you should be worried",
          "PFI is the more accurate number of the two",
        ],
        correctIndex: 0,
        explanation:
          "PFI reacts to today's cash movement; the Fundamentals Score reflects your last 90 days. A single large payment can move one without moving the other — that's expected, not a contradiction.",
      },
      {
        id: "score-index-divergence-check-2",
        kind: "which-action",
        prompt:
          "You notice PFI and your Fundamentals Score pointing in opposite directions this week. What's the right next step?",
        choices: [
          "Check whether your underlying pattern has actually changed over recent weeks, not just today",
          "Immediately cut spending until the two numbers agree",
          "Ignore the Fundamentals Score until PFI recovers",
          "Assume the dashboard has a bug and wait for it to fix itself",
        ],
        correctIndex: 0,
        explanation:
          "A one-day divergence is normal. The useful question is whether your actual pattern — not just today's number — has changed, which is exactly what the Fundamentals Score is built to answer.",
      },
    ],
    completionSummary:
      "You can now read a PFI/Fundamentals Score divergence as a normal signal about time horizons, not a contradiction.",
  },
};
```

- [ ] **Step 4: Register the concept in `content/index.ts`**

Modify `src/lib/concepts/content/index.ts` — add the import and array entry:

```ts
// src/lib/concepts/content/index.ts
import type { FinancialConcept } from "../types";
import { revenue } from "./revenue";
import { operatingExpenses } from "./operating-expenses";
import { cashFlow } from "./cash-flow";
import { freeCashFlow } from "./free-cash-flow";
import { savingsRate } from "./savings-rate";
import { assets } from "./assets";
import { liabilities } from "./liabilities";
import { netWorth } from "./net-worth";
import { liquidity } from "./liquidity";
import { debtPressure } from "./debt-pressure";
import { shortTermObligations } from "./short-term-obligations";
import { financialFlexibility } from "./financial-flexibility";
import { retainedCash } from "./retained-cash";
import { capitalAllocation } from "./capital-allocation";
import { availableCapital } from "./available-capital";
import { scoreIndexDivergence } from "./score-index-divergence";

export const ALL_CONCEPTS: FinancialConcept[] = [
  revenue,
  operatingExpenses,
  cashFlow,
  freeCashFlow,
  savingsRate,
  assets,
  liabilities,
  netWorth,
  liquidity,
  debtPressure,
  shortTermObligations,
  financialFlexibility,
  retainedCash,
  capitalAllocation,
  availableCapital,
  scoreIndexDivergence,
];
```

- [ ] **Step 5: Add the new module in `modules.ts`**

Modify `src/lib/concepts/modules.ts` — add a fourth module:

```ts
// src/lib/concepts/modules.ts
import type { Module } from "./types";

export const MODULES: Module[] = [
  {
    id: "how-your-household-operates",
    title: "How Your Household Operates",
    order: 1,
    conceptIds: ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"],
  },
  {
    id: "reading-your-household-balance-sheet",
    title: "Reading Your Household Balance Sheet",
    order: 2,
    conceptIds: ["assets", "liabilities", "net-worth", "liquidity"],
  },
  {
    id: "financial-pressure-and-flexibility",
    title: "Financial Pressure and Flexibility",
    order: 3,
    conceptIds: [
      "debt-pressure",
      "short-term-obligations",
      "financial-flexibility",
      "retained-cash",
      "capital-allocation",
    ],
  },
  {
    id: "understanding-your-score",
    title: "Understanding Your Score",
    order: 4,
    conceptIds: ["score-index-divergence"],
  },
];
```

- [ ] **Step 6: Run the concepts test suite and confirm the expected failures**

Run: `pnpm test src/lib/concepts`
Expected: FAIL — specifically:
- `content.test.ts` → `"has exactly 15 concepts, 10 with lessons"` (now 16 concepts, 11 with lessons)
- `progress.test.ts` → `"lessonSequence"` (`toHaveLength(10)`, now 11), `"academyTallies"` (`lessonsTotal: 10`/`modulesTotal: 3`, now 11/4), and `"adjacentLessons"` (`seq[9]`'s `next` is no longer `null`)

All other tests in this run (`registry.test.ts`, `engine-binding.test.ts`, `label-consistency.test.ts`, `score-term-map.test.ts`, `term-sheet.test.ts`, and the rest of `content.test.ts`) should already PASS — if any of those fail too, stop and re-check Step 1/2/3 against this plan before continuing.

- [ ] **Step 7: Update `content.test.ts`'s hardcoded counts and add Module 4 coverage**

In `src/lib/concepts/content.test.ts`, replace the `"has exactly 15 concepts, 10 with lessons"` test:

```ts
  it("has exactly 16 concepts, 11 with lessons", () => {
    expect(ALL_CONCEPTS).toHaveLength(16);
    expect(ALL_CONCEPTS.filter((c) => c.lesson)).toHaveLength(11);
  });
```

Add two new tests immediately after the existing `"has Module 3 anchored by the debt-pressure lesson"` test, matching the Module 1/2/3 pattern:

```ts
  it("has Module 4 with its concept in teaching order", () => {
    const m4 = MODULES.find((m) => m.id === "understanding-your-score");
    expect(m4?.conceptIds).toEqual(["score-index-divergence"]);
  });

  it("gives every Module 4 concept a full lesson", () => {
    for (const id of ["score-index-divergence"]) {
      expect(ALL_CONCEPTS.find((c) => c.id === id)?.lesson, id).toBeDefined();
    }
  });
```

Replace the `"classifies every concept"` test's single `pfi_metric` assertion with a loop covering both `pfi_metric` concepts:

```ts
  it("classifies every concept, matching the spec's assignment table", () => {
    const byId = (id: string) => ALL_CONCEPTS.find((c) => c.id === id);
    for (const id of ["available-capital", "score-index-divergence"]) {
      expect(byId(id)?.classification, id).toBe("pfi_metric");
    }
    for (const id of ["savings-rate", "net-worth", "debt-pressure", "financial-flexibility", "retained-cash", "liquidity"]) {
      expect(byId(id)?.classification, id).toBe("household_adaptation");
    }
    for (const id of ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "assets", "liabilities", "short-term-obligations", "capital-allocation"]) {
      expect(byId(id)?.classification, id).toBe("standard_finance");
    }
  });
```

- [ ] **Step 8: Update `progress.test.ts`'s hardcoded counts**

In `src/lib/concepts/progress.test.ts`, update the `lessonSequence` test's length assertion:

```ts
describe("lessonSequence", () => {
  it("is the 11 lesson-bearing published concepts in module order", () => {
    const seq = lessonSequence(CONCEPT_REGISTRY);
    expect(seq).toHaveLength(11);
    expect(seq[0]).toBe("revenue"); // module 1 starts the curriculum
    // glossary-only records never appear
    for (const id of ["short-term-obligations", "financial-flexibility", "retained-cash", "capital-allocation", "available-capital"]) {
      expect(seq).not.toContain(id);
    }
    // every entry has a lesson
    for (const id of seq) expect(CONCEPT_REGISTRY.byId(id)?.lesson).toBeTruthy();
  });
});
```

Update the `academyTallies` `"zero progress"` test:

```ts
  it("zero progress", () => {
    expect(academyTallies(CONCEPT_REGISTRY, [])).toEqual({
      lessonsCompleted: 0, lessonsTotal: 11, modulesCompleted: 0, modulesTotal: 4, percentComplete: 0,
    });
  });
```

Update the `academyTallies` `"partial progress"` test's `percentComplete` (1 of 11 rounds to 9, not 10):

```ts
  it("partial progress; in-progress rows do not count as completed", () => {
    const t = academyTallies(CONCEPT_REGISTRY, [done("revenue"), row("cash-flow")]);
    expect(t.lessonsCompleted).toBe(1);
    expect(t.modulesCompleted).toBe(0);
    expect(t.percentComplete).toBe(9);
  });
```

Update the `adjacentLessons` test — `seq[9]` (`debt-pressure`) is no longer last; add the new last-entry (`seq[10]`, `score-index-divergence`) assertion:

```ts
describe("adjacentLessons", () => {
  it("walks module order across boundaries and clamps the ends", () => {
    const seq = lessonSequence(CONCEPT_REGISTRY);
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[0]!)).toEqual({ prev: null, next: seq[1] });
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[5]!)).toEqual({ prev: seq[4], next: seq[6] });
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[9]!)).toEqual({ prev: seq[8], next: seq[10] });
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[10]!)).toEqual({ prev: seq[9], next: null });
    expect(adjacentLessons(CONCEPT_REGISTRY, "short-term-obligations")).toEqual({ prev: null, next: null });
  });
});
```

- [ ] **Step 9: Run the concepts test suite again and confirm it passes**

Run: `pnpm test src/lib/concepts`
Expected: PASS — all files in `src/lib/concepts/` green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/concepts/types.ts src/lib/concepts/content/score-index-divergence.ts src/lib/concepts/content/index.ts src/lib/concepts/modules.ts src/components/academy/LessonSections.tsx src/lib/concepts/content.test.ts src/lib/concepts/progress.test.ts
git commit -m "feat(academy): add PFI vs Fundamentals Score concept and lesson"
```

---

### Task 2: Update the Academy e2e spec's hardcoded lesson count

**Files:**
- Modify: `e2e/academy.spec.ts:34`
- Modify: `e2e/academy.spec.ts:125`

**Interfaces:**
- Consumes: no code interface — this is a literal-text assertion update tracking Task 1's `lessonsTotal` change (10 → 11).

- [ ] **Step 1: Update both hardcoded lesson-count assertions**

In `e2e/academy.spec.ts`, the test `"academy tab routes to the zero-progress home with no locks"` currently asserts:

```ts
  await expect(page.getByText("0 of 10 lessons")).toBeVisible();
```

Change to:

```ts
  await expect(page.getByText("0 of 11 lessons")).toBeVisible();
```

The test `"home reflects the completion"` currently asserts:

```ts
  await expect(page.getByText("1 of 10 lessons")).toBeVisible();
```

Change to:

```ts
  await expect(page.getByText("1 of 11 lessons")).toBeVisible();
```

- [ ] **Step 2: Confirm no other stale count references remain**

Run: `grep -n "of 10 lessons" e2e/academy.spec.ts`
Expected: no output (both occurrences updated).

This file's assertions run against a live Supabase project (`e2e/fixtures/password-user.ts`) and are exercised in full during Task 4's verification pass, not standalone here.

- [ ] **Step 3: Commit**

```bash
git add e2e/academy.spec.ts
git commit -m "test(e2e): update Academy lesson-count assertions for the new lesson"
```

---

### Task 3: Repoint `DivergenceExplainer`'s `Learn` control to the lesson route

**Files:**
- Modify: `src/components/dashboard/DivergenceExplainer.tsx`

**Interfaces:**
- Consumes: the concept id `"score-index-divergence"` from Task 1 (used as a literal string in the route href — the Academy route pattern is `/academy/[conceptId]`, established by `src/app/academy/[conceptId]/page.tsx`).
- Produces: no change to `DivergenceExplainer`'s exported props (`{ sentence: string }`) — `AIDivergenceExplainer.tsx` (its only consumer) needs no changes.

- [ ] **Step 1: Replace the inline-expand toggle with a link to the lesson**

Current `src/components/dashboard/DivergenceExplainer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/Card";

const LEARN_COPY =
  "These track different time horizons. PFI behaves like a share price and reacts to recent cash movement; the Fundamentals Score measures your 90-day financial health. A short-term cash swing can move one without the other.";

/** Deterministic reconciliation line. State is carried by text + icon, never color alone. */
export function DivergenceExplainer({ sentence }: { sentence: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-3">
      <div role="note" aria-label="How your two numbers relate">
        <p className="flex items-start gap-1.5 text-sm text-secondary">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>{sentence}</span>
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 text-xs font-medium text-secondary underline decoration-dotted underline-offset-2 hover:text-primary"
        >
          {open ? "Hide" : "Learn"}
        </button>
        {open && <p className="mt-2 text-xs text-tertiary">{LEARN_COPY}</p>}
      </div>
    </Card>
  );
}
```

Replace with:

```tsx
"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/Card";

/** Deterministic reconciliation line. State is carried by text + icon, never color alone. */
export function DivergenceExplainer({ sentence }: { sentence: string }) {
  return (
    <Card className="p-3">
      <div role="note" aria-label="How your two numbers relate">
        <p className="flex items-start gap-1.5 text-sm text-secondary">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>{sentence}</span>
        </p>
        <Link
          href="/academy/score-index-divergence"
          className="mt-1 inline-block text-xs font-medium text-secondary underline decoration-dotted underline-offset-2 hover:text-primary"
        >
          Learn
        </Link>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: both succeed with no errors (route count unchanged — `/academy/[conceptId]` already exists as a dynamic route, so no new route is added).

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/DivergenceExplainer.tsx
git commit -m "feat(dashboard): repoint divergence Learn control to the Academy lesson"
```

---

### Task 4: Docs, decision record, and full verification

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/CURRENT_PHASE.md`
- Modify: `docs/superpowers/specs/2026-07-22-score-index-divergence-academy-lesson-design.md`

**Interfaces:** none — documentation and verification only.

- [ ] **Step 1: Amend the design spec to match the plan-time corrections**

In `docs/superpowers/specs/2026-07-22-score-index-divergence-academy-lesson-design.md`, in the "Concept record" table, change the `dataMetricKey` row from:

```
| `dataMetricKey` | `"signal:divergence"` — authored now for forward compatibility; ... |
```

to:

```
| `dataMetricKey` | Omitted (see "Plan-time corrections" in the implementation plan) — `engine-binding.test.ts` only recognizes `metric:`/`report:`/`snapshot:`/`position:` namespaces, so an unresolvable `signal:` key would fail that test. The lesson ships with no `dataMetricKey`/`personalApplication`, rendering sample-only content via the same `HouseholdApplication` fallback path every other not-yet-live concept already uses. |
```

And in the "Testing plan" section, change the `DivergenceExplainer` component-test bullet from:

```
- **`DivergenceExplainer` component test:** replace the "toggle reveals inline
  paragraph" assertion with a "renders a link to
  `/academy/score-index-divergence`" assertion.
```

to:

```
- **`DivergenceExplainer` verification:** this codebase has no `*.test.tsx`
  files — verified via `pnpm typecheck`/`pnpm build` plus live browser visual
  QA instead, consistent with how every other component change in this
  project is verified.
```

- [ ] **Step 2: Add a DECISIONS.md entry**

Append to `docs/DECISIONS.md`:

```markdown
## 39. 2026-07-22 — PFI vs Fundamentals Score gets a full Academy lesson; new "Understanding Your Score" module

**Decision:** Author a full Academy concept/lesson (`score-index-divergence`, classification
`pfi_metric`) explaining why PFI and the Fundamentals Score can move in opposite
directions, and repoint the dashboard divergence line's `› Learn` control from its
interim inline-text expand (shipped in the divergence-explainer slice) to this lesson's
route. The lesson needed a home in the Academy's module structure; none of the three
existing modules (household-operations literacy, balance-sheet literacy,
pressure/flexibility literacy) fit a lesson about interpreting PFI's own headline
numbers, so a fourth module, "Understanding Your Score," was added, seeded with just
this one lesson. The lesson ships without a `dataMetricKey`/`personalApplication` —
`engine-binding.test.ts` only resolves the `metric:`/`report:`/`snapshot:`/`position:`
namespaces derived from the real financial engine, and a real household-level
divergence signal is transient (computed per-request by `computeDivergence`, never
stored), so there is nothing yet to bind a live namespace to. The lesson renders
sample-only content, the same fallback path 6 of the other 15 concepts already use
pending their own resolver work.

**Alternatives:** leave the lesson unlisted/moduleless like `available-capital`
(rejected — divergence is rare and no demo profile naturally triggers it, so most users
would never discover a lesson they can only reach mid-event); tack the lesson onto the
existing "Financial Pressure and Flexibility" module (rejected — thematically it's about
interpreting PFI's own product mechanics, not household financial-statement literacy,
and a dedicated module leaves room for future product-literacy lessons); author a
`signal:` engine-binding namespace now to make the lesson live (rejected as
out-of-scope — it requires first deciding whether/where to persist divergence
occurrences, which the divergence-explainer slice explicitly deferred).

**Consequences:** Academy now has 4 modules and 16 concepts (11 with lessons, up from
15/10). `AcademyHome`'s dynamic tallies (`academyTallies()`) and `lessonSequence()`
required no code changes — only the hardcoded test-count assertions in
`content.test.ts`, `progress.test.ts`, and `e2e/academy.spec.ts` needed updating. A
future slice that wires a real `signal:` namespace (or persists divergence
occurrences) can attach a `dataMetricKey` to this concept without any other change.
This concept's title is the first that is an acronym-bearing phrase rather than a plain
noun, which exposed that `LessonSections` lowercases the title into its opening heading
("What is pfi vs fundamentals score?"); rather than lowercase-mangle an acronym, an
additive optional `Lesson.openingHeading` override was introduced (default behavior
unchanged for all other lessons) and set to "What is a divergence?" here.
```

(If a decision numbered 39 already exists by the time this step runs — e.g. another
slice landed one first — renumber this entry to the next free number and update the
heading accordingly.)

- [ ] **Step 3: Update CURRENT_PHASE.md**

Add a bullet to the top of the "In progress" section (or amend the "Last updated" line,
following this file's established convention) noting: the PFI vs Fundamentals Score
Academy lesson (Spec 2) is complete on this branch — concept + fourth module authored,
`DivergenceExplainer`'s `Learn` control now links to `/academy/score-index-divergence`
instead of expanding inline text, `pnpm check` green, visual QA done at 390px/1280px
(see Step 5 below for the exact figures once run).

- [ ] **Step 4: Full `pnpm check`**

Run: `pnpm check`
Expected: exit 0 — lint 0 errors (1 pre-existing `AccountSheet.tsx` warning is normal),
typecheck clean, all unit tests passing (the `src/lib/concepts` suite from Task 1's
Step 9, plus everything else unaffected), build succeeds with all routes compiling.

- [ ] **Step 5: Visual QA at 390px and 1280px**

No demo profile naturally produces a divergence (confirmed during the divergence-explainer
slice's own QA). Reuse that slice's throwaway override technique: temporarily force
`computeDivergence`'s result in `src/app/page.tsx` so `DivergenceExplainer` renders, start
`pnpm dev`, and in a browser at 390×844 then 1280×900:

1. Confirm the divergence line renders on the home dashboard with the `Learn` link
   (not a toggle button) visible.
2. Click `Learn`; confirm it navigates to `/academy/score-index-divergence` (not an
   inline expand).
3. Confirm the lesson page renders: page heading "PFI vs Fundamentals Score"; the first
   numbered section reads **"1. What is a divergence?"** (the `openingHeading` override —
   NOT "1. What is pfi vs fundamentals score?"); the memorable-distinction callout ("PFI
   reacts today; the Fundamentals Score remembers the last 90 days."); and the "Applied
   to your household" section showing the sample Rivera-household example (not live data).
4. Answer both knowledge checks (one right, one wrong) and confirm the lesson completes
   with the "Lesson complete" status and the completion summary.
5. Navigate to `/academy` and confirm a fourth module, "Understanding Your Score,"
   appears with this lesson listed and marked completed, and the header tally reads
   "1 of 11 lessons."
6. Revert the temporary `page.tsx` override before finishing.

- [ ] **Step 6: Commit**

```bash
git add docs/DECISIONS.md docs/CURRENT_PHASE.md docs/superpowers/specs/2026-07-22-score-index-divergence-academy-lesson-design.md
git commit -m "docs(academy): record the PFI vs Fundamentals Score lesson decision and verification"
```
