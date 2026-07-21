# Academy Content Refinement — Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the concept schema (classification, memorable distinction, structured formulas, comparison rows, whereUsed, stable check IDs), un-gate the definition sheet's depth content with progress-aware CTAs and a completed-state live-data block, upgrade the lesson experience (memorable-distinction callout, visual calculation, live household application, interpretation, revised completion card), and ship two reference content implementations: the Revenue lesson and the Available Capital definition sheet.

**Architecture:** Everything shipped by Slices 1–3 is preserved — routes, `academy_progress` + RLS, derived status, completion-regardless-of-correctness, tabs, nav, `Sheet` primitive, server-action patterns. This slice changes content types (`src/lib/concepts/types.ts`), content data, the two presentation layers (definition sheet, lesson sections), and adds one shared live-data resolver (`src/lib/data/concept-live.ts`) consumed server-side by the lesson page and lazily (via a server action) by the sheet.

**Tech Stack:** Next.js 16 App Router, strict TypeScript, Tailwind 4 tokens, Supabase, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-21-academy-content-refinement-reference-design.md` (incl. amendments `4af3e5e`).

## Base branch note

This work builds on Academy Slice 3, which is PR #22 (`worktree-worktree-academy-slice3`), possibly not yet merged at execution time.

- **If PR #22 is merged:** branch from updated `main`; cherry-pick the spec/plan doc commits from local main if not pushed (`cc12412`, `4af3e5e`, plus this plan's commit).
- **If not merged:** branch from `worktree-worktree-academy-slice3` HEAD (`d113d53`) and cherry-pick those same doc commits; the eventual PR targets the Slice 3 branch (retarget to `main` after #22 merges).

Copy `.env.local` from the main checkout into any new worktree or the build fails on missing Supabase env vars.

## Global Constraints

- Preserve untouched: `/academy` + `/academy/[conceptId]` routes and server-rendered patterns; `academy_progress` table and owner-only RLS; derived progress states; completion regardless of correctness; Lesson/Related tabs and the reserved future "Your Data" tab; Academy bottom-nav tab; the `Sheet` primitive; server-action conventions; mobile/desktop responsive shell.
- Knowledge-check correctness is never persisted; client-side comparison to `correctIndex` is display-only.
- No locks, streaks, fluency ladders, filter chips, or "unlocked" framing. States: Not started / In progress / Completed. Completion copy must not imply the concept was previously locked.
- No shame language; explanations show identically for right and wrong answers.
- Never color alone — every state marker pairs icon and/or text.
- No internal engineering language ("audit ruling", "spec findings", task numbers, DECISIONS references) in any user-facing string.
- `src/lib/concepts/` stays framework-free (no React/Next imports).
- Sample data always labeled ("Sample household" / "Sample figures"); live data labeled "Calculated from your data"; never invent household figures; render nothing rather than fake values when data is absent.
- Renderer formula precedence: `concept.formulaRows` → `lesson.calculation.formula` → `concept.formula`. `formula` (plain text) must be present whenever `formulaRows` is (accessible fallback).
- Stable check IDs: `<concept-id>-check-<n>` (1-based), unique within a lesson.
- `pnpm check` (lint + typecheck + test + build) green before any completion claim.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Additive concept schema — classification + new optional fields on all 15 concepts

**Files:**
- Modify: `src/lib/concepts/types.ts`
- Modify: `src/lib/concepts/registry.ts` (validateRegistry)
- Modify: `src/lib/concepts/index.ts` (barrel exports)
- Modify: all 15 files in `src/lib/concepts/content/` (one `classification` line each)
- Test: `src/lib/concepts/registry.test.ts`, `src/lib/concepts/content.test.ts`

**Interfaces:**
- Produces: `ConceptClassification`, `FormulaRow`, `ComparisonRow` types; `FinancialConcept` gains required `classification` and optional `plainEnglishSummary`, `memorableDistinction`, `formulaRows`, `comparisonRows`, `interpretation`, `whereUsed`. Later tasks import all of these from `@/lib/concepts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/concepts/registry.test.ts` (inside `describe("validateRegistry")`):

```ts
  it("rejects formulaRows without an accessible formula fallback", () => {
    const bad = concept("a", { formulaRows: [{ label: "X" }] });
    expect(validateRegistry([bad], [])).toContainEqual(expect.stringContaining("formulaRows"));
  });

  it("rejects empty whereUsed entries", () => {
    const bad = concept("a", { whereUsed: ["Report", " "] });
    expect(validateRegistry([bad], [])).toContainEqual(expect.stringContaining("whereUsed"));
  });
```

Append to `src/lib/concepts/content.test.ts` (inside `describe("authored content")`):

```ts
  it("classifies every concept, matching the spec's assignment table", () => {
    const byId = (id: string) => ALL_CONCEPTS.find((c) => c.id === id);
    expect(byId("available-capital")?.classification).toBe("pfi_metric");
    for (const id of ["savings-rate", "net-worth", "debt-pressure", "financial-flexibility", "retained-cash", "liquidity"]) {
      expect(byId(id)?.classification, id).toBe("household_adaptation");
    }
    for (const id of ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "assets", "liabilities", "short-term-obligations", "capital-allocation"]) {
      expect(byId(id)?.classification, id).toBe("standard_finance");
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/concepts/registry.test.ts src/lib/concepts/content.test.ts`
Expected: FAIL — typecheck errors on `formulaRows`/`whereUsed` (unknown fields) and `classification` undefined.

- [ ] **Step 3: Extend `types.ts`**

Add above `FinancialConcept`:

```ts
/** How the term relates to established finance vocabulary (spec §Definition-sheet header). */
export type ConceptClassification = "standard_finance" | "household_adaptation" | "pfi_metric";

/** One line of a statement-style visual calculation. */
export interface FormulaRow {
  label: string;
  operator?: "+" | "-" | "=";
  /** Binds to a live figure; same namespace as PersonalApplication.metricKey. */
  valueKey?: string;
  /** Sample display value (must be presented labeled as sample). */
  staticValue?: string | number;
}

/** One included/excluded example supporting the memorable distinction. */
export interface ComparisonRow {
  label: string;
  included: boolean;
  explanation?: string;
}
```

Add to `FinancialConcept` (after `title`):

```ts
  classification: ConceptClassification;
```

and after `whyItMatters`:

```ts
  /** One strong sentence for the definition sheet; sheet falls back to shortDefinition+fullDefinition when absent. */
  plainEnglishSummary?: string;
  /** The lesson's one retained takeaway, e.g. "Not every deposit is revenue." */
  memorableDistinction?: string;
  /** Structured calculation block; `formula` remains the accessible text fallback and is required alongside. */
  formulaRows?: FormulaRow[];
  comparisonRows?: ComparisonRow[];
  /** What increases/decreases mean — and don't mean — in context. Never "higher is always good". */
  interpretation?: string;
  /** Surfaces where the concept actually appears in PFI. Supersedes lesson.reinforcementPreview when present. */
  whereUsed?: string[];
```

- [ ] **Step 4: Extend `validateRegistry`** (in `registry.ts`, inside the per-concept loop after the prerequisite checks)

```ts
    if (c.formulaRows && c.formulaRows.length > 0 && !c.formula) {
      errors.push(`${c.id}: formulaRows requires formula as its accessible text fallback`);
    }
    for (const w of c.whereUsed ?? []) {
      if (!w.trim()) errors.push(`${c.id}: whereUsed contains an empty entry`);
    }
```

- [ ] **Step 5: Add `classification` to every content file**

Insert `classification: "<value>",` directly after the `title:` line in each file:

| File | Value |
|---|---|
| revenue.ts, operating-expenses.ts, cash-flow.ts, free-cash-flow.ts, assets.ts, liabilities.ts, short-term-obligations.ts, capital-allocation.ts | `"standard_finance"` |
| savings-rate.ts, net-worth.ts, debt-pressure.ts, financial-flexibility.ts, retained-cash.ts, liquidity.ts | `"household_adaptation"` |
| available-capital.ts | `"pfi_metric"` |

- [ ] **Step 6: Update the `registry.test.ts` `concept` fixture** — add `classification: "standard_finance" as const,` after `title: id,`.

- [ ] **Step 7: Update the barrel** — in `src/lib/concepts/index.ts` extend the types export line:

```ts
export type { ComparisonRow, ConceptClassification, ConceptId, DataRequirement, FinancialConcept, FormulaRow, KnowledgeCheck, Lesson, Module, PersonalApplication } from "./types";
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/concepts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/concepts
git commit -m "feat(concepts): classification + memorable-distinction/formula-rows/comparison/whereUsed schema on all concepts"
```

---

### Task 2: Lesson shape renames + stable knowledge-check IDs, end-to-end

**Files:**
- Modify: `src/lib/concepts/types.ts` (Lesson, KnowledgeCheck)
- Modify: `src/lib/concepts/registry.ts` (check validation)
- Modify: all 10 lesson-bearing files in `src/lib/concepts/content/` (mechanical rename)
- Modify: `src/lib/concepts/progress.ts` + `src/lib/concepts/progress.test.ts`
- Modify: `src/app/actions/academy.ts`
- Modify: `src/components/academy/KnowledgeChecks.tsx`, `src/components/academy/LessonSections.tsx`, `src/components/academy/LessonView.tsx`
- Test: `src/lib/concepts/registry.test.ts`

**Interfaces:**
- Produces: `KnowledgeCheck` single interface with `id: string` + `kind` union; `Lesson` with `opening`, `knowledgeChecks`, optional `calculation.formula`, optional `completionSummary`/`reinforcementPreview`; `CheckResponse { checkId: string; choiceIndex: number }`; `validateCheckAnswer(registry, conceptId, checkId: string, choiceIndex: number)`; `appendCheckResponse(totalChecks, responses, { checkId, choiceIndex })`; `answerKnowledgeCheck(conceptId, checkId, choiceIndex)`.

- [ ] **Step 1: Rewrite the Lesson/KnowledgeCheck types** in `types.ts`:

```ts
export interface KnowledgeCheck {
  /** Stable persistence key, e.g. "revenue-check-1" — never re-derived from position. */
  id: string;
  kind: "interpretation" | "identify-figure" | "which-action";
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

/** The lesson template (spec §Lesson framework; named fields per decision #7). */
export interface Lesson {
  opening: string;                    // 1. household scenario, then names the standard term
  standardTerm: string;               // 2.
  whyItMattersExtended?: string;      // extends concept.whyItMatters
  calculation?: { formula?: string; walkthrough: string }; // formula legacy — concept.formulaRows preferred
  genericExample: string;             // Rivera-household sample, labeled as sample
  personalApplication?: PersonalApplication;
  commonMisunderstanding: string;
  knowledgeChecks: KnowledgeCheck[];  // 1–2 items, stable ids
  completionSummary?: string;         // completion-card copy; generic fluency fallback when absent
  reinforcementPreview?: string;      // legacy; superseded by concept.whereUsed on migrated concepts
}
```

(The old three-arm union collapses into one interface — the arms were identical except `kind`.)

- [ ] **Step 2: Update `validateRegistry`'s check section** in `registry.ts` (replace the existing `knowledgeCheck` block):

```ts
    const checks = c.lesson?.knowledgeChecks;
    if (checks && (checks.length < 1 || checks.length > 2)) {
      errors.push(`${c.id}: lessons need 1–2 knowledge checks, found ${checks.length}`);
    }
    const checkIds = new Set<string>();
    for (const [i, check] of (checks ?? []).entries()) {
      if (check.correctIndex < 0 || check.correctIndex >= check.choices.length) {
        errors.push(`${c.id}: knowledge check ${i} correctIndex out of bounds`);
      }
      if (!check.id.trim()) errors.push(`${c.id}: knowledge check ${i} has an empty id`);
      if (checkIds.has(check.id)) errors.push(`${c.id}: duplicate knowledge check id ${check.id}`);
      checkIds.add(check.id);
    }
```

- [ ] **Step 3: Mechanically migrate all 10 lesson files** (`revenue`, `operating-expenses`, `cash-flow`, `free-cash-flow`, `savings-rate`, `assets`, `liabilities`, `net-worth`, `liquidity`, `debt-pressure`):
  - `intro:` → `opening:`
  - `knowledgeCheck: [` → `knowledgeChecks: [`
  - each check object gains `id: "<concept-id>-check-<n>"` as its first property (n = 1-based array position; e.g. `revenue-check-1`, `revenue-check-2`)
  - `kind: "interpretation" as const` → `kind: "interpretation"` (the `as const` is no longer needed with the plain interface; harmless if left)
  - No other content changes in this task.

- [ ] **Step 4: Update `registry.test.ts`** — rewrite the `lesson` fixture and the two check tests:

```ts
const lesson = (over: Partial<NonNullable<FinancialConcept["lesson"]>> = {}) => ({
  opening: "Opening.",
  standardTerm: "Term.",
  genericExample: "Sample example.",
  commonMisunderstanding: "Misunderstanding.",
  knowledgeChecks: [
    { id: "c-1", kind: "interpretation" as const, prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "Because." },
  ],
  reinforcementPreview: "Preview.",
  ...over,
});
```

In "rejects lessons with zero or more than two knowledge checks" and "rejects out-of-bounds correctIndex", rename `knowledgeCheck:` → `knowledgeChecks:` and give each literal check an `id` (`"k1"`, `"k2"`, `"k3"` — distinct). Add:

```ts
  it("rejects duplicate knowledge-check ids within a lesson", () => {
    const bad = concept("a", {
      lesson: lesson({
        knowledgeChecks: [
          { id: "dup", kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "x" },
          { id: "dup", kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "x" },
        ],
      }),
    });
    expect(validateRegistry([bad], [])).toContainEqual(expect.stringContaining("duplicate knowledge check id"));
  });
```

- [ ] **Step 5: Update `progress.ts`** — `CheckResponse` and the two check helpers:

```ts
export interface CheckResponse {
  checkId: string;
  choiceIndex: number;
}
```

```ts
/** Server-action guard. Returns a human-readable error, or null when recordable. */
export function validateCheckAnswer(
  registry: ConceptRegistry,
  conceptId: string,
  checkId: string,
  choiceIndex: number,
): string | null {
  const c = lessonConcept(registry, conceptId);
  if (!c) return "Unknown lesson";
  const check = c.lesson!.knowledgeChecks.find((k) => k.id === checkId);
  if (!check) return "Unknown knowledge check";
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= check.choices.length) {
    return "Unknown choice";
  }
  return null;
}

/** First answer wins; duplicates are ignored. allAnswered ⇒ the caller sets completed_at. */
export function appendCheckResponse(
  totalChecks: number,
  responses: CheckResponse[],
  response: CheckResponse,
): { responses: CheckResponse[]; allAnswered: boolean; duplicate: boolean } {
  const duplicate = responses.some((r) => r.checkId === response.checkId);
  const next = duplicate ? responses : [...responses, response];
  const answered = new Set(next.map((r) => r.checkId));
  return { responses: next, allAnswered: answered.size >= totalChecks, duplicate };
}
```

- [ ] **Step 6: Update `progress.test.ts`** — replace the `validateCheckAnswer` and `appendCheckResponse` describe blocks:

```ts
describe("validateCheckAnswer", () => {
  it("accepts a valid answer", () => {
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", "revenue-check-1", 0)).toBeNull();
  });
  it("rejects unknown lessons, unknown check ids, and out-of-bounds choices", () => {
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "no-such-concept", "x", 0)).toBe("Unknown lesson");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "short-term-obligations", "x", 0)).toBe("Unknown lesson");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", "nope", 0)).toBe("Unknown knowledge check");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", "revenue-check-1", 99)).toBe("Unknown choice");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", "revenue-check-1", 0.5)).toBe("Unknown choice");
  });
});

describe("appendCheckResponse", () => {
  it("appends and reports allAnswered when every check has a response", () => {
    const first = appendCheckResponse(2, [], { checkId: "c-1", choiceIndex: 1 });
    expect(first).toEqual({ responses: [{ checkId: "c-1", choiceIndex: 1 }], allAnswered: false, duplicate: false });
    const second = appendCheckResponse(2, first.responses, { checkId: "c-2", choiceIndex: 0 });
    expect(second.allAnswered).toBe(true);
  });
  it("first answer wins; duplicates are ignored", () => {
    const prior = [{ checkId: "c-1", choiceIndex: 1 }];
    const dup = appendCheckResponse(2, prior, { checkId: "c-1", choiceIndex: 2 });
    expect(dup).toEqual({ responses: prior, allAnswered: false, duplicate: true });
  });
});
```

If other tests in the file construct `checkResponses` literals with `checkIndex`, update them to `checkId` form.

- [ ] **Step 7: Update the server action** — in `src/app/actions/academy.ts`, `answerKnowledgeCheck`'s signature and body:

```ts
export async function answerKnowledgeCheck(
  conceptId: string,
  checkId: string,
  choiceIndex: number,
): Promise<AnswerResult> {
```

- `validateCheckAnswer(CONCEPT_REGISTRY, conceptId, checkId, choiceIndex)`
- `appendCheckResponse(concept.lesson!.knowledgeChecks.length, prior, { checkId, choiceIndex })`
- Everything else unchanged.

- [ ] **Step 8: Update the three components** (minimal, keep compiling — Task 6 does the real UI work):
  - `KnowledgeChecks.tsx`: `answerFor(check.id)`, `choose(check.id, c)`, `key={check.id}`, `const answered = answerFor(check.id)` inside the map, and the responses state keyed by `checkId`.
  - `LessonSections.tsx`: `lesson.intro` → `lesson.opening`; guard the calculation formula (`lesson.calculation.formula ?? concept.formula`, render the `<p>` only when that is truthy); guard the reinforcement section (`...(lesson.reinforcementPreview ? [{...}] : [])`).
  - `LessonView.tsx`: `checks={concept.lesson!.knowledgeChecks}`.

- [ ] **Step 9: Run everything**

Run: `pnpm vitest run src/lib/concepts && pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add src/lib/concepts src/app/actions/academy.ts src/components/academy
git commit -m "feat(concepts): lesson opening/knowledgeChecks rename with stable check ids end-to-end"
```

---

### Task 3: Shared presentation components

**Files:**
- Create: `src/components/concepts/ClassificationLabel.tsx`
- Create: `src/components/concepts/FormulaBlock.tsx`
- Create: `src/components/concepts/ComparisonRows.tsx`
- Create: `src/components/concepts/WhereUsedList.tsx`

**Interfaces:**
- Produces: `ClassificationLabel({ classification })`, `FormulaBlock({ rows, fallbackText, values?, showValues? })`, `ComparisonRows({ rows })`, `WhereUsedList({ items })`. Consumed by Tasks 5–6. No unit tests (repo convention: presentational components are covered by e2e + live verification); verified by typecheck here and usage later.

- [ ] **Step 1: ClassificationLabel**

```tsx
// src/components/concepts/ClassificationLabel.tsx
import type { ConceptClassification } from "@/lib/concepts";

const LABELS: Record<ConceptClassification, string> = {
  standard_finance: "Standard finance term",
  household_adaptation: "Household adaptation",
  pfi_metric: "PFI metric",
};

/** Subtle text label — never a dominant badge (spec §Definition-sheet header). */
export function ClassificationLabel({ classification }: { classification: ConceptClassification }) {
  return (
    <p className="text-xs font-medium tracking-wide text-tertiary uppercase">{LABELS[classification]}</p>
  );
}
```

- [ ] **Step 2: FormulaBlock**

```tsx
// src/components/concepts/FormulaBlock.tsx
import type { FormulaRow } from "@/lib/concepts";

/**
 * Statement-style visual calculation. The visual layout is aria-hidden;
 * `fallbackText` (the concept's plain `formula` string) is the screen-reader
 * text, so the block is accessible without parsing the row grid.
 */
export function FormulaBlock({
  rows,
  fallbackText,
  values,
  showValues = true,
}: {
  rows: FormulaRow[];
  fallbackText: string;
  /** Resolved live values keyed by FormulaRow.valueKey. */
  values?: Record<string, string>;
  /** false = structure only (the definition sheet hides sample staticValues). */
  showValues?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-inset p-3">
      <p className="sr-only">{fallbackText}</p>
      <div aria-hidden className="flex flex-col font-mono text-sm">
        {rows.map((row, i) => {
          const isTotal = row.operator === "=";
          const value = showValues ? ((row.valueKey && values?.[row.valueKey]) ?? row.staticValue) : undefined;
          return (
            <div
              key={i}
              className={`flex items-baseline justify-between gap-3 py-0.5 ${
                isTotal ? "mt-1 border-t border-border-strong pt-1.5 font-semibold text-primary" : "text-secondary"
              }`}
            >
              <span>
                {row.operator === "-" ? "− " : row.operator === "+" ? "+ " : ""}
                {row.label}
              </span>
              {value !== undefined && <span className="tabular">{value}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ComparisonRows**

```tsx
// src/components/concepts/ComparisonRows.tsx
import { Check, X } from "lucide-react";
import type { ComparisonRow } from "@/lib/concepts";

/** Responsive included/excluded list — stacked rows, never a wide table (spec §Section 2). */
export function ComparisonRows({ rows }: { rows: ComparisonRow[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-inset p-2.5">
          {row.included ? (
            <span className="flex w-16 shrink-0 items-center gap-1 text-[11px] font-medium text-positive">
              <Check size={12} aria-hidden /> Counts
            </span>
          ) : (
            <span className="flex w-16 shrink-0 items-center gap-1 text-[11px] font-medium text-tertiary">
              <X size={12} aria-hidden /> Doesn&apos;t
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-primary">{row.label}</span>
            {row.explanation && <span className="text-xs text-secondary">{row.explanation}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: WhereUsedList**

```tsx
// src/components/concepts/WhereUsedList.tsx
/** Compact surface list for "Where it appears" / "Where you'll see this in PFI". */
export function WhereUsedList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 pl-4">
      {items.map((item) => (
        <li key={item} className="list-disc text-sm text-secondary">
          {item}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

```bash
git add src/components/concepts
git commit -m "feat(concepts): shared ClassificationLabel/FormulaBlock/ComparisonRows/WhereUsedList components"
```

---

### Task 4: Live-data resolver + `getConceptLive` server action

**Files:**
- Create: `src/lib/data/concept-live.ts`
- Test: `src/lib/data/concept-live.test.ts`
- Modify: `src/app/actions/academy.ts` (append `getConceptLive`)

**Interfaces:**
- Consumes: `getReportData` (`src/lib/data/queries.ts`), `enumeratePeriods`/`latestCompletePeriod`/`computePeriodStatement`/`buildIndexSeries`/`formatDollars` from `@/lib/financial-engine`.
- Produces: `ConceptLiveData { periodLabel, display, priorLabel, priorDisplay, deltaDisplay }`; `computeReportLive(metricKey, snapshots, transactions, events): ConceptLiveData | null` (pure); `getConceptLiveData(supabase, metricKey): Promise<ConceptLiveData | null>`; server action `getConceptLive(conceptId): Promise<{ error: string; data?: ConceptLiveData | null }>`.

- [ ] **Step 1: Confirm the engine exports** (should all resolve from the barrel):

Run: `grep -n "export function formatDollars\|export function enumeratePeriods\|export function latestCompletePeriod\|export function computePeriodStatement\|export function buildIndexSeries" src/lib/financial-engine/*.ts`
Expected: one hit each. Note `formatDollars`'s exact output format (e.g. whether `formatDollars(6200)` renders `$6,200` or `$6,200.00`) — the test in Step 2 asserts with a tolerant regex either way.

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/data/concept-live.test.ts
import { describe, expect, it } from "vitest";
import type { DailySnapshot, TransactionInput } from "@/lib/financial-engine";
import { computeReportLive } from "./concept-live";

// Minimal casts: computeReportLive only touches snapshot date/liquidAssets/
// revolvingBalances/nearTermObligations and transaction postedDate/amount/
// direction/category/isTransfer for the revenue field.
const snap = (date: string): DailySnapshot =>
  ({ date, liquidAssets: 1000, revolvingBalances: 0, nearTermObligations: 0 }) as DailySnapshot;
const income = (postedDate: string, amount: number): TransactionInput =>
  ({ postedDate, amount, direction: "inflow", category: "income", isTransfer: false }) as TransactionInput;

// April–June; June ends on a month boundary so it is the latest complete period.
const SNAPSHOTS = ["2026-04-01", "2026-04-30", "2026-05-31", "2026-06-30"].map(snap);

describe("computeReportLive", () => {
  it("resolves current and prior monthly figures for report:revenue", () => {
    const live = computeReportLive(
      "report:revenue",
      SNAPSHOTS,
      [income("2026-05-15", 5800), income("2026-06-15", 6200)],
      [],
    );
    expect(live).not.toBeNull();
    expect(live!.display).toMatch(/6,?200/);
    expect(live!.priorDisplay).toMatch(/5,?800/);
    expect(live!.deltaDisplay).toMatch(/^\+/);
    expect(live!.deltaDisplay).toContain("vs");
  });

  it("returns null for non-report namespaces and unknown fields", () => {
    expect(computeReportLive("metric:liquid_runway_months", SNAPSHOTS, [], [])).toBeNull();
    expect(computeReportLive("report:nope", SNAPSHOTS, [], [])).toBeNull();
  });

  it("returns null with no snapshots", () => {
    expect(computeReportLive("report:revenue", [], [], [])).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/lib/data/concept-live.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/data/concept-live.ts
// Resolves a concept's metricKey to display-ready live household figures.
// Slice A implements the report:* namespace only (sufficient for Revenue);
// metric:/snapshot:/position: keys return null and are added by Slices B/C
// as their concepts migrate (spec decision #10).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildIndexSeries,
  computePeriodStatement,
  enumeratePeriods,
  formatDollars,
  latestCompletePeriod,
  type DailySnapshot,
  type FinancialEvent,
  type TransactionInput,
} from "@/lib/financial-engine";
import { getReportData } from "./queries";

export interface ConceptLiveData {
  periodLabel: string;
  display: string;               // formatted current-period value
  priorLabel: string | null;
  priorDisplay: string | null;
  deltaDisplay: string | null;   // e.g. "+$400 vs May 2026"; null without a prior period
}

const REPORT_FIELDS = ["revenue", "operatingExpenses", "freeCashFlow", "savings", "savingsRatePct"] as const;
type ReportField = (typeof REPORT_FIELDS)[number];

/** Pure resolution over already-loaded data — unit-tested; the fetch wrapper below stays thin. */
export function computeReportLive(
  metricKey: string,
  snapshots: DailySnapshot[],
  transactions: TransactionInput[],
  events: FinancialEvent[],
): ConceptLiveData | null {
  const [ns, field] = metricKey.split(":");
  if (ns !== "report" || !REPORT_FIELDS.includes(field as ReportField)) return null;
  if (snapshots.length === 0) return null;

  const indexPoints = buildIndexSeries(snapshots).points;
  const periods = enumeratePeriods(snapshots, "monthly");
  const current = latestCompletePeriod(periods);
  if (!current) return null;

  const statement = computePeriodStatement(snapshots, transactions, events, indexPoints, current);
  const idx = periods.findIndex((p) => p.key === current.key);
  const prior = idx > 0 ? periods[idx - 1]! : null;
  const priorStatement = prior
    ? computePeriodStatement(snapshots, transactions, events, indexPoints, prior)
    : null;

  const f = field as ReportField;
  const isPct = f === "savingsRatePct";
  const fmt = (v: number) => (isPct ? `${v.toFixed(1)}%` : formatDollars(v));
  const value = statement[f];
  const priorValue = priorStatement ? priorStatement[f] : null;

  let deltaDisplay: string | null = null;
  if (priorValue !== null && prior) {
    const delta = value - priorValue;
    const magnitude = isPct ? `${Math.abs(delta).toFixed(1)} pts` : formatDollars(Math.abs(delta));
    deltaDisplay = `${delta >= 0 ? "+" : "−"}${magnitude} vs ${prior.label}`;
  }

  return {
    periodLabel: current.label,
    display: fmt(value),
    priorLabel: prior?.label ?? null,
    priorDisplay: priorValue !== null ? fmt(priorValue) : null,
    deltaDisplay,
  };
}

export async function getConceptLiveData(
  supabase: SupabaseClient,
  metricKey: string,
): Promise<ConceptLiveData | null> {
  if (!metricKey.startsWith("report:")) return null;
  const { snapshots, transactions, events } = await getReportData(supabase);
  return computeReportLive(metricKey, snapshots, transactions, events);
}
```

(If `formatDollars` prefixes its own sign or differs in name, adapt at Step 1's findings — the test's tolerant regex still gates correctness.)

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run src/lib/data/concept-live.test.ts`
Expected: PASS.

- [ ] **Step 6: Append the server action** to `src/app/actions/academy.ts`:

```ts
import { getConceptLiveData, type ConceptLiveData } from "@/lib/data/concept-live";

/** Lazy completed-state fetch for the definition sheet (spec decision #10). */
export async function getConceptLive(
  conceptId: string,
): Promise<{ error: string; data?: ConceptLiveData | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const c = CONCEPT_REGISTRY.byId(conceptId);
  if (!c || c.status !== "published" || !c.dataMetricKey) return { error: "", data: null };
  const data = await getConceptLiveData(supabase, c.dataMetricKey);
  return { error: "", data };
}
```

- [ ] **Step 7: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

```bash
git add src/lib/data/concept-live.ts src/lib/data/concept-live.test.ts src/app/actions/academy.ts
git commit -m "feat(academy): concept live-data resolver (report namespace) + getConceptLive action"
```

---

### Task 5: Definition sheet — progress states, un-gated depth, completed live block

**Files:**
- Modify: `src/lib/data/queries.ts` (replace `getCompletedConceptIds` with `getAcademyStatusIds`)
- Modify: `src/app/layout.tsx`
- Modify: `src/components/concepts/TermSheetProvider.tsx`
- Modify: `src/lib/concepts/term-sheet.ts`
- Create: `src/components/concepts/ConceptLiveBlock.tsx`
- Modify: `src/components/concepts/TermDefinitionSheet.tsx`
- Test: `src/lib/concepts/term-sheet.test.ts` (full rewrite)

**Interfaces:**
- Consumes: Task 3 components, Task 4 `getConceptLive`, `ConceptProgressStatus` (progress.ts).
- Produces: `getAcademyStatusIds(supabase): Promise<{ inProgress: string[]; completed: string[] }>`; `buildTermSheetModel(registry, conceptId, opts?: { progress?: ConceptProgressStatus })` returning the new `TermSheetModel` (below); `TermSheetProvider({ children, academyStatus? })`.

- [ ] **Step 1: Write the failing term-sheet tests** — replace `src/lib/concepts/term-sheet.test.ts` entirely:

```ts
import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import { buildRegistry } from "./registry";
import { buildTermSheetModel } from "./term-sheet";
import type { FinancialConcept } from "./types";

const glossary: FinancialConcept = {
  id: "alpha", title: "Alpha", classification: "standard_finance",
  shortDefinition: "Short.", fullDefinition: "Full.", whyItMatters: "Matters.",
  relatedConceptIds: [], prerequisiteConceptIds: [], status: "published",
};
const withLesson: FinancialConcept = {
  ...glossary, id: "beta", title: "Beta",
  plainEnglishSummary: "One strong sentence.",
  whereUsed: ["Report"],
  lesson: {
    opening: "O.", standardTerm: "S.", genericExample: "Sample x.", commonMisunderstanding: "M.",
    knowledgeChecks: [{ id: "beta-check-1", kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "E." }],
  },
};
const draft: FinancialConcept = { ...glossary, id: "gamma", status: "draft" };
const REG = buildRegistry([glossary, withLesson, draft], []);

describe("buildTermSheetModel", () => {
  it("returns null for unknown or unpublished concepts", () => {
    expect(buildTermSheetModel(REG, "nope")).toBeNull();
    expect(buildTermSheetModel(REG, "gamma")).toBeNull();
  });

  it("un-gates whyItMatters and classification at every state", () => {
    const m = buildTermSheetModel(REG, "alpha");
    expect(m?.whyItMatters).toBe("Matters.");
    expect(m?.classification).toBe("standard_finance");
  });

  it("falls back to shortDefinition + fullDefinition when plainEnglishSummary is absent", () => {
    const m = buildTermSheetModel(REG, "alpha");
    expect(m?.summary).toBe("Short.");
    expect(m?.detail).toBe("Full.");
  });

  it("uses plainEnglishSummary alone when present", () => {
    const m = buildTermSheetModel(REG, "beta");
    expect(m?.summary).toBe("One strong sentence.");
    expect(m?.detail).toBeUndefined();
    expect(m?.whereUsed).toEqual(["Report"]);
  });

  it("passes lesson progress through and forces glossary-only to not-started", () => {
    expect(buildTermSheetModel(REG, "beta", { progress: "in-progress" })?.progress).toBe("in-progress");
    expect(buildTermSheetModel(REG, "beta", { progress: "completed" })?.progress).toBe("completed");
    expect(buildTermSheetModel(REG, "beta")?.progress).toBe("not-started");
    expect(buildTermSheetModel(REG, "alpha", { progress: "completed" })?.progress).toBe("not-started");
  });

  it("builds against the real registry without error for every published concept", () => {
    for (const c of CONCEPT_REGISTRY.published()) {
      expect(buildTermSheetModel(CONCEPT_REGISTRY, c.id), c.id).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/concepts/term-sheet.test.ts`
Expected: FAIL — `summary`/`progress` don't exist yet.

- [ ] **Step 3: Rewrite `term-sheet.ts`**

```ts
// src/lib/concepts/term-sheet.ts
// Framework-free (no React/Next). Builds the definition-sheet view-model.
// Depth content (whyItMatters, businessContext, classification) is un-gated —
// shown at every progress state; completion only adds the live-data block
// (spec 2026-07-21-academy-content-refinement, decision #4).
import type { ConceptProgressStatus } from "./progress";
import type { ConceptRegistry } from "./registry";
import type { ConceptClassification, ConceptId, FinancialConcept, FormulaRow } from "./types";

export interface TermSheetRelated {
  id: ConceptId;
  title: string;
}

export interface TermSheetModel {
  id: ConceptId;
  title: string;
  classification: ConceptClassification;
  /** plainEnglishSummary when authored; shortDefinition otherwise. */
  summary: string;
  /** fullDefinition, only for concepts not yet migrated to plainEnglishSummary. */
  detail?: string;
  whyItMatters: string;
  businessContext?: string;
  formula?: string;
  formulaRows?: FormulaRow[];
  householdAdaptation?: string;
  whereUsed: string[];
  related: TermSheetRelated[];
  hasLesson: boolean;
  /** Always "not-started" for glossary-only concepts. */
  progress: ConceptProgressStatus;
  /** Present ⇒ the completed live block may fetch (via getConceptLive). */
  dataMetricKey?: string;
}

export function buildTermSheetModel(
  registry: ConceptRegistry,
  conceptId: ConceptId,
  opts?: { progress?: ConceptProgressStatus },
): TermSheetModel | null {
  const c = registry.byId(conceptId);
  if (!c || c.status !== "published") return null;

  const related: TermSheetRelated[] = c.relatedConceptIds
    .map((id) => registry.byId(id))
    .filter((r): r is FinancialConcept => !!r && r.status === "published")
    .map((r) => ({ id: r.id, title: r.title }));

  const hasLesson = !!c.lesson;
  const progress: ConceptProgressStatus = hasLesson ? (opts?.progress ?? "not-started") : "not-started";

  return {
    id: c.id,
    title: c.title,
    classification: c.classification,
    summary: c.plainEnglishSummary ?? c.shortDefinition,
    detail: c.plainEnglishSummary ? undefined : c.fullDefinition,
    whyItMatters: c.whyItMatters,
    businessContext: c.businessContext,
    formula: c.formula,
    formulaRows: c.formulaRows,
    householdAdaptation: c.householdAdaptation,
    whereUsed: c.whereUsed ?? [],
    related,
    hasLesson,
    progress,
    dataMetricKey: c.dataMetricKey,
  };
}
```

- [ ] **Step 4: Run term-sheet tests** — `pnpm vitest run src/lib/concepts/term-sheet.test.ts` → PASS.

- [ ] **Step 5: Replace the queries function** — in `src/lib/data/queries.ts`, delete `getCompletedConceptIds` and add:

```ts
export interface AcademyStatusIds {
  inProgress: string[];
  completed: string[];
}

/** Started/completed concept ids for the term-sheet CTA states. Empty when
 *  signed out or on error — the sheet then shows not-started, the safe
 *  degradation (never fake completion). */
export async function getAcademyStatusIds(supabase: SupabaseClient): Promise<AcademyStatusIds> {
  const { data, error } = await supabase.from("academy_progress").select("concept_id, completed_at");
  if (error) return { inProgress: [], completed: [] };
  const out: AcademyStatusIds = { inProgress: [], completed: [] };
  for (const r of data ?? []) {
    (r.completed_at ? out.completed : out.inProgress).push(r.concept_id as string);
  }
  return out;
}
```

Verify `getCompletedConceptIds` has no other callers: `grep -rn "getCompletedConceptIds" src/` → only the layout (updated next step).

- [ ] **Step 6: Layout + provider threading**

`src/app/layout.tsx`:

```tsx
import { getAcademyStatusIds } from "@/lib/data/queries";
// ...
  const supabase = await createClient();
  const academyStatus = await getAcademyStatusIds(supabase);
  // ...
  <TermSheetProvider academyStatus={academyStatus}>
```

`src/components/concepts/TermSheetProvider.tsx` — new props + status mapping (state/api/render otherwise unchanged):

```tsx
import type { ConceptId, ConceptProgressStatus } from "@/lib/concepts";

export function TermSheetProvider({
  children,
  academyStatus,
}: {
  children: ReactNode;
  academyStatus?: { inProgress: string[]; completed: string[] };
}) {
  // ...existing stack state and api...
  const statusFor = useMemo(() => {
    const started = new Set(academyStatus?.inProgress ?? []);
    const completed = new Set(academyStatus?.completed ?? []);
    return (id: ConceptId): ConceptProgressStatus =>
      completed.has(id) ? "completed" : started.has(id) ? "in-progress" : "not-started";
  }, [academyStatus]);

  const currentId = stack.at(-1) ?? null;
  const model = currentId
    ? buildTermSheetModel(CONCEPT_REGISTRY, currentId, { progress: statusFor(currentId) })
    : null;
  // ...render unchanged...
}
```

- [ ] **Step 7: ConceptLiveBlock**

```tsx
// src/components/concepts/ConceptLiveBlock.tsx
"use client";

import { useEffect, useState } from "react";
import { getConceptLive } from "@/app/actions/academy";
import type { ConceptLiveData } from "@/lib/data/concept-live";

/**
 * Completed-state deepening: the user's current figure for this concept,
 * fetched lazily when the sheet opens. Renders nothing while loading and
 * nothing at all when the household lacks the data — never a fake value.
 */
export function ConceptLiveBlock({ conceptId }: { conceptId: string }) {
  const [live, setLive] = useState<ConceptLiveData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getConceptLive(conceptId).then((result) => {
      if (!cancelled && !result.error) setLive(result.data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [conceptId]);

  if (!live) return null;
  return (
    <div className="rounded-xl border border-border-subtle bg-inset p-3">
      <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Your data</p>
      <p className="text-sm text-primary">
        {live.periodLabel}: <span className="tabular font-semibold">{live.display}</span>
      </p>
      {live.deltaDisplay && <p className="mt-0.5 text-xs text-secondary">{live.deltaDisplay}</p>}
    </div>
  );
}
```

- [ ] **Step 8: Rewrite `TermDefinitionSheet.tsx`'s body** (render order per spec §Definition sheet):

```tsx
"use client";

import { ChevronLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Sheet } from "@/components/ui/Sheet";
import type { ConceptId } from "@/lib/concepts";
import type { TermSheetModel } from "@/lib/concepts/term-sheet";
import { ClassificationLabel } from "./ClassificationLabel";
import { ConceptLiveBlock } from "./ConceptLiveBlock";
import { FormulaBlock } from "./FormulaBlock";
import { WhereUsedList } from "./WhereUsedList";

const CTA_LABEL = {
  "not-started": "Take the lesson",
  "in-progress": "Continue lesson",
  completed: "Review lesson",
} as const;

export function TermDefinitionSheet({
  model,
  canGoBack,
  onBack,
  onClose,
  onRelated,
}: {
  model: TermSheetModel | null;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onRelated: (id: ConceptId) => void;
}) {
  return (
    <Sheet open={model !== null} onClose={onClose} title={model?.title ?? ""} contentKey={model?.id}>
      {model && (
        <div className="flex flex-col gap-4">
          {canGoBack && (
            <button
              type="button"
              onClick={onBack}
              className="-mt-1 flex items-center gap-1 self-start text-xs text-secondary hover:text-primary"
            >
              <ChevronLeft size={14} aria-hidden />
              Back
            </button>
          )}

          <div className="flex flex-col gap-1">
            <ClassificationLabel classification={model.classification} />
            {model.businessContext && (
              <p className="text-xs leading-relaxed text-tertiary">{model.businessContext}</p>
            )}
          </div>

          <p className="text-base leading-relaxed text-primary">{model.summary}</p>
          {model.detail && <p className="text-sm leading-relaxed text-secondary">{model.detail}</p>}

          {model.progress === "completed" && (
            <p className="flex items-center gap-1.5 text-xs text-secondary">
              <CheckCircle2 size={14} aria-hidden className="text-positive" />
              Academy concept completed
            </p>
          )}

          <div>
            <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Why it matters</p>
            <p className="text-sm leading-relaxed text-secondary">{model.whyItMatters}</p>
          </div>

          {model.formulaRows && model.formula ? (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Formula</p>
              <FormulaBlock rows={model.formulaRows} fallbackText={model.formula} showValues={false} />
              {model.householdAdaptation && (
                <p className="mt-2 text-xs text-tertiary">Household: {model.householdAdaptation}</p>
              )}
            </div>
          ) : (
            (model.formula || model.householdAdaptation) && (
              <div className="rounded-xl border border-border-subtle bg-inset p-3">
                {model.formula && (
                  <>
                    <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Formula</p>
                    <p className="font-mono text-sm text-primary">{model.formula}</p>
                  </>
                )}
                {model.householdAdaptation && (
                  <p className={model.formula ? "mt-2 text-xs text-tertiary" : "text-xs text-tertiary"}>
                    Household: {model.householdAdaptation}
                  </p>
                )}
              </div>
            )
          )}

          {model.whereUsed.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Where it appears</p>
              <WhereUsedList items={model.whereUsed} />
            </div>
          )}

          {model.progress === "completed" && model.dataMetricKey && <ConceptLiveBlock conceptId={model.id} />}

          {model.related.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-tertiary uppercase">Related</p>
              <div className="flex flex-wrap gap-2">
                {model.related.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onRelated(r.id)}
                    className="rounded-full border border-border-subtle bg-inset px-3 py-1.5 text-xs text-primary hover:border-border-strong focus:border-border-strong focus:outline-none"
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {model.hasLesson && (
            <Link
              href={`/academy/${model.id}`}
              onClick={onClose}
              className="mt-1 self-start rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-border-strong"
            >
              {CTA_LABEL[model.progress]}
            </Link>
          )}
        </div>
      )}
    </Sheet>
  );
}
```

- [ ] **Step 9: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green (build confirms the async layout change compiles everywhere).

```bash
git add src/lib/data/queries.ts src/app/layout.tsx src/components/concepts src/lib/concepts/term-sheet.ts src/lib/concepts/term-sheet.test.ts
git commit -m "feat(concepts): progress-aware definition sheet — un-gated depth, classification, whereUsed, completed live block"
```

---

### Task 6: Lesson experience — distinction callout, visual calculation, household application, completion card

**Files:**
- Create: `src/components/academy/HouseholdApplication.tsx`
- Modify: `src/components/academy/LessonSections.tsx` (full rewrite below)
- Modify: `src/components/academy/KnowledgeChecks.tsx` (completion card + props)
- Modify: `src/components/academy/LessonView.tsx` (thread new props)
- Modify: `src/app/academy/[conceptId]/page.tsx` (live-data fetch)

**Interfaces:**
- Consumes: Task 3 components, Task 4 `getConceptLiveData`/`ConceptLiveData`, Task 2 `knowledgeChecks`/`completionSummary`.
- Produces: `LessonView({ conceptId, initialResponses, initialCompleted, live })`; `HouseholdApplication({ live, genericExample })`.

- [ ] **Step 1: HouseholdApplication**

```tsx
// src/components/academy/HouseholdApplication.tsx
import type { ConceptLiveData } from "@/lib/data/concept-live";

/**
 * "Apply it to the household": live data when available, clearly-labeled
 * sample otherwise (spec §Section 6 + §Personalized content rules).
 * Standalone so it can migrate into a future "Your Data" tab untouched.
 */
export function HouseholdApplication({
  live,
  genericExample,
}: {
  live: ConceptLiveData | null;
  genericExample: string;
}) {
  if (live) {
    return (
      <div className="rounded-xl border border-border-subtle bg-inset p-3">
        <span className="mb-1 inline-block rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-tertiary">
          Calculated from your data
        </span>
        <p className="text-sm text-primary">
          {live.periodLabel}: <span className="tabular font-semibold">{live.display}</span>
        </p>
        {live.deltaDisplay && <p className="mt-0.5 text-xs text-secondary">{live.deltaDisplay}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border-subtle bg-inset p-3">
      <span className="mb-1 inline-block rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-tertiary">
        Sample household
      </span>
      <p className="text-sm text-secondary">{genericExample}</p>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `LessonSections.tsx`**

```tsx
import type { ReactNode } from "react";
import type { FinancialConcept } from "@/lib/concepts";
import type { ConceptLiveData } from "@/lib/data/concept-live";
import { ComparisonRows } from "@/components/concepts/ComparisonRows";
import { FormulaBlock } from "@/components/concepts/FormulaBlock";
import { WhereUsedList } from "@/components/concepts/WhereUsedList";
import { HouseholdApplication } from "./HouseholdApplication";

/**
 * The lesson framework (spec §Lesson page). Sections render conditionally so
 * concepts not yet migrated to the new fields keep their Slice 3 layout;
 * the memorable-distinction callout sits unnumbered after the opening.
 */
export function LessonSections({
  concept,
  live,
}: {
  concept: FinancialConcept;
  live: ConceptLiveData | null;
}) {
  const lesson = concept.lesson!;
  const legacyFormula = lesson.calculation?.formula ?? concept.formula;

  const sections: { title: string; body: ReactNode }[] = [
    { title: `What is ${concept.title.toLowerCase()}?`, body: <p>{lesson.opening}</p> },
    { title: "The standard term", body: <p>{lesson.standardTerm}</p> },
    {
      title: "Why it matters",
      body: <p>{[concept.whyItMatters, lesson.whyItMattersExtended].filter(Boolean).join(" ")}</p>,
    },
    ...(lesson.calculation
      ? [{
          title: "How it's calculated",
          body: (
            <>
              {concept.formulaRows && concept.formula ? (
                <>
                  {concept.formulaRows.some((r) => r.staticValue !== undefined) && (
                    <span className="mb-1 inline-block rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-tertiary">
                      Sample figures
                    </span>
                  )}
                  <FormulaBlock rows={concept.formulaRows} fallbackText={concept.formula} />
                </>
              ) : legacyFormula ? (
                <p className="rounded-lg bg-inset p-2 font-mono text-sm text-primary">{legacyFormula}</p>
              ) : null}
              <p className="mt-2">{lesson.calculation.walkthrough}</p>
            </>
          ),
        }]
      : []),
    {
      title: "Applied to your household",
      body: <HouseholdApplication live={live} genericExample={lesson.genericExample} />,
    },
    ...(concept.interpretation
      ? [{ title: "How to read it", body: <p>{concept.interpretation}</p> }]
      : []),
    {
      title: "Common misunderstanding",
      body: (
        <p className="rounded-xl border border-border-subtle bg-inset p-3">{lesson.commonMisunderstanding}</p>
      ),
    },
    ...(concept.whereUsed?.length
      ? [{ title: "Where you'll see this in PFI", body: <WhereUsedList items={concept.whereUsed} /> }]
      : lesson.reinforcementPreview
        ? [{ title: "Where you'll see this in PFI", body: <p>{lesson.reinforcementPreview}</p> }]
        : []),
  ];

  const [first, ...rest] = sections;

  return (
    <div className="flex flex-col gap-5">
      <section key={first!.title}>
        <h2 className="mb-1 text-sm font-semibold text-primary">1. {first!.title}</h2>
        <div className="text-sm leading-relaxed text-secondary">{first!.body}</div>
      </section>

      {concept.memorableDistinction && (
        <div className="rounded-xl border border-border-strong bg-inset p-4">
          <p className="text-base font-semibold text-primary">{concept.memorableDistinction}</p>
          {concept.comparisonRows && concept.comparisonRows.length > 0 && (
            <div className="mt-3">
              <ComparisonRows rows={concept.comparisonRows} />
            </div>
          )}
        </div>
      )}

      {rest.map((s, i) => (
        <section key={s.title}>
          <h2 className="mb-1 text-sm font-semibold text-primary">
            {i + 2}. {s.title}
          </h2>
          <div className="text-sm leading-relaxed text-secondary">{s.body}</div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Revise `KnowledgeChecks.tsx`'s props + completion card** (checkId logic is already in from Task 2; this step replaces the completion block and adds props):

New props:

```tsx
export function KnowledgeChecks({
  conceptId, conceptTitle, checks, initialResponses, initialCompleted, completionSummary, nextConcept,
}: {
  conceptId: string;
  conceptTitle: string;
  checks: KnowledgeCheck[];
  initialResponses: CheckResponse[];
  initialCompleted: boolean;
  completionSummary?: string;
  nextConcept: { id: string; title: string } | null;
}) {
```

Add `import { useTermSheet } from "@/components/concepts/TermSheetProvider";` and `const { openTerm } = useTermSheet();`. Replace the completed block with:

```tsx
      {completed && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-inset p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <CheckCircle2 size={16} aria-hidden className="text-positive" />
            Lesson complete
          </p>
          <p className="text-xs text-secondary">
            {completionSummary ??
              `You can now recognize ${conceptTitle.toLowerCase()} throughout PFI and how it applies to your household.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openTerm(conceptId)} className={ACTION_CLASS}>
              Review concept
            </button>
            <Link href="/academy" className={ACTION_CLASS}>
              Back to Academy
            </Link>
            {nextConcept && (
              <Link href={`/academy/${nextConcept.id}`} className={ACTION_CLASS}>
                Next: {nextConcept.title}
              </Link>
            )}
          </div>
        </div>
      )}
```

with, at module scope:

```tsx
const ACTION_CLASS =
  "rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-border-strong";
```

(The old "This term's definition sheet now includes its full analytical depth." line is removed — spec: no "unlocked" framing.)

- [ ] **Step 4: Thread props through `LessonView.tsx`**

- Props: add `live: ConceptLiveData | null` (`import type { ConceptLiveData } from "@/lib/data/concept-live";`).
- `<LessonSections concept={concept} live={live} />`
- KnowledgeChecks call:

```tsx
        <KnowledgeChecks
          conceptId={conceptId}
          conceptTitle={concept.title}
          checks={concept.lesson!.knowledgeChecks}
          initialResponses={initialResponses}
          initialCompleted={initialCompleted}
          completionSummary={concept.lesson!.completionSummary}
          nextConcept={nextConcept ? { id: nextConcept.id, title: nextConcept.title } : null}
        />
```

- [ ] **Step 5: Lesson page fetches live data** — in `src/app/academy/[conceptId]/page.tsx`:

```tsx
import { getConceptLiveData } from "@/lib/data/concept-live";
// ... after the notFound() guard and progress fetch:
  const concept = lessonConcept(CONCEPT_REGISTRY, conceptId)!;
  const pa = concept.lesson!.personalApplication;
  const live = pa ? await getConceptLiveData(supabase, pa.metricKey) : null;

  return (
    <LessonView
      conceptId={conceptId}
      initialResponses={row?.checkResponses ?? []}
      initialCompleted={!!row?.completedAt}
      live={live}
    />
  );
```

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green. In `pnpm dev`, `/academy/revenue` renders the Slice 3-equivalent layout (no new concept fields authored yet) with the "Applied to your household" section showing live data when demo data is loaded, "Sample household" otherwise.

```bash
git add src/components/academy src/app/academy
git commit -m "feat(academy): lesson framework upgrade — distinction callout, visual calc, household application, fluency completion card"
```

---

### Task 7: Revenue reference content

**Files:**
- Modify: `src/lib/concepts/content/revenue.ts` (full rewrite below)

**Interfaces:**
- Consumes: all Task 1–2 schema fields. Renderers from Tasks 5–6 pick the new fields up automatically.

- [ ] **Step 1: Rewrite the file**

```ts
// src/lib/concepts/content/revenue.ts
import type { FinancialConcept } from "../types";

export const revenue: FinancialConcept = {
  id: "revenue",
  title: "Revenue",
  classification: "standard_finance",
  shortDefinition:
    "All the money your household brings in — pay, side income, benefits, and other earnings.",
  plainEnglishSummary:
    "New money your household earned or received from outside sources during a period — paychecks, side income, and benefits.",
  memorableDistinction: "Not every deposit is revenue.",
  fullDefinition:
    "Revenue is the total of every dollar your household received in a period, from every source. It includes wages, side income, and benefits. It does not include money that simply moved between your own accounts — a transfer from savings to checking is not new money, so it is not revenue.",
  whyItMatters:
    "Revenue is the starting point for everything else in your household's finances. Operating expenses are paid out of it, free cash flow is measured against it, and your savings rate is a share of it. Nothing downstream can be understood without first knowing what came in.",
  formula: "Paychecks + side income + benefits + other external earnings = revenue",
  formulaRows: [
    { label: "Paychecks", staticValue: "$5,800" },
    { label: "Side income", operator: "+", staticValue: "$250" },
    { label: "Benefits", operator: "+", staticValue: "$150" },
    { label: "Revenue", operator: "=", staticValue: "$6,200" },
  ],
  comparisonRows: [
    { label: "Paycheck", included: true, explanation: "New money earned from outside the household." },
    { label: "Side-income payment", included: true, explanation: "New externally earned income." },
    { label: "Transfer from savings", included: false, explanation: "The household already owned it." },
    { label: "Loan proceeds", included: false, explanation: "Borrowed money creates a liability, not income." },
    { label: "Purchase refund", included: false, explanation: "It reverses prior spending rather than creating income." },
  ],
  interpretation:
    "Rising revenue is not the same as being better off. Revenue can rise while free cash flow falls if operating expenses rise faster — and steady revenue with falling expenses can strengthen a household more than a raise. Read revenue together with operating expenses and free cash flow, not on its own.",
  householdAdaptation:
    "Corporate revenue means sales of goods or services. A household doesn't sell anything in that sense, so PFI's version counts every source of income instead — wages, side income, and benefits. Refunds are treated as reducing spending rather than as revenue, since they reverse a purchase rather than create new income.",
  businessContext:
    "Analysts call revenue “the top line” because it sits at the top of a company's income statement. Growth is judged against it — a company is described as growing or shrinking based on whether revenue is rising or falling period over period.",
  commonMisunderstanding:
    "Revenue is not what you keep — that's free cash flow. A raise increases revenue, but if operating expenses rise just as fast, the household is no better off in cash terms even though revenue went up.",
  whereUsed: [
    "Household statement (Report)",
    "Management commentary",
    "Free cash flow calculation",
    "Savings-rate calculation",
    "“What moved your line” on the dashboard",
  ],
  relatedConceptIds: ["operating-expenses", "cash-flow"],
  prerequisiteConceptIds: [],
  dataMetricKey: "report:revenue",
  status: "published",
  lesson: {
    opening:
      "Every household has money entering from outside — paychecks, side work, benefits, other earnings. Before PFI can measure spending, cash flow, or savings efficiency, that incoming money needs a name. In business and investing, it is called revenue.",
    standardTerm:
      "“Revenue” is the standard term for money a business (or, here, a household) brings in during a period. It's also called “the top line” because of where it appears on a company's income statement.",
    calculation: {
      walkthrough:
        "Add up every dollar that came into the household in the period from an outside source: paychecks, side income, benefits, and similar earnings. Leave out anything that was already the household's money — like a transfer from savings into checking — and anything that reverses spending or creates a debt, like a refund or a loan disbursement.",
    },
    genericExample:
      "Sample figures: the Rivera household's revenue for the month is $6,200 — $5,800 in paychecks, $250 of side income, and $150 in benefits. That $6,200 is the number everything else in this module is measured against.",
    personalApplication: {
      metricKey: "report:revenue",
      interpretationRules:
        "Describe the period total plainly and note whether it has been steady or has varied across recent periods. If income is irregular — for example, mixing salary with variable side income — say so neutrally, without treating variability itself as good or bad. Unavailable: name the missing data (income transactions); never estimate.",
      requiresData: ["income-transactions"],
    },
    commonMisunderstanding:
      "Revenue is not the same as free cash flow. Revenue is everything that came in; free cash flow is what's left after operating expenses are paid. A household's revenue can rise while its free cash flow shrinks, if expenses grew even faster.",
    knowledgeChecks: [
      {
        id: "revenue-check-1",
        kind: "identify-figure",
        prompt: "Which of these is revenue?",
        choices: [
          "A paycheck deposited into checking",
          "A transfer from savings into checking",
          "A refund credited after returning an item",
          "A loan disbursement deposited into checking",
        ],
        correctIndex: 0,
        explanation:
          "A paycheck is new money from an outside source, so it's revenue. Transfers move money the household already had; refunds reverse a purchase; a loan disbursement is borrowed money, not earned income.",
      },
      {
        id: "revenue-check-2",
        kind: "interpretation",
        prompt: "A household's revenue rose this month, but its free cash flow fell. What's the most likely explanation?",
        choices: [
          "Operating expenses rose faster than revenue did",
          "The revenue figure must be wrong",
          "The household transferred money to savings",
          "Free cash flow only depends on revenue",
        ],
        correctIndex: 0,
        explanation:
          "Free cash flow is revenue minus operating expenses. If revenue went up but free cash flow went down, expenses must have grown by even more.",
      },
    ],
    completionSummary:
      "You can now recognize revenue throughout PFI and understand how it drives free cash flow, savings rate, and your household's performance measurements.",
  },
};
```

Notes: `lesson.calculation.formula` and `lesson.reinforcementPreview` are deliberately dropped (superseded by `formulaRows` and `whereUsed`); check 1's explanation keeps the sentence "A paycheck is new money from an outside source" (the e2e regex depends on it); `whereUsed` lists only implemented surfaces.

- [ ] **Step 2: Verify + commit**

Run: `pnpm vitest run src/lib/concepts && pnpm typecheck && pnpm test`
Expected: all green (content tests, engine bindings, label consistency unaffected).

In `pnpm dev`, `/academy/revenue` now shows: opening → "Not every deposit is revenue." callout with the five comparison rows → standard term → why it matters → statement-style calculation with "Sample figures" pill → household application → "How to read it" → misunderstanding callout → whereUsed list. The sheet (from `/report`) shows classification "Standard finance term", the summary, why-it-matters, structure-only formula block, and "Where it appears".

```bash
git add src/lib/concepts/content/revenue.ts
git commit -m "content(academy): Revenue reference lesson — distinction, comparisons, visual calc, interpretation, whereUsed"
```

---

### Task 8: Available Capital reference sheet + internal-language guard

**Files:**
- Modify: `src/lib/concepts/content/available-capital.ts` (full rewrite below)
- Test: `src/lib/concepts/content.test.ts` (banned-token guard)

- [ ] **Step 1: Write the failing guard test** (append to `content.test.ts`):

```ts
  it("keeps internal engineering language out of user-facing content", () => {
    const banned = [/audit ruling/i, /spec finding/i, /\btask \d/i, /decisions #/i, /implementation plan/i];
    for (const c of ALL_CONCEPTS) {
      const serialized = JSON.stringify(c);
      for (const pattern of banned) {
        expect(serialized, `${c.id} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/concepts/content.test.ts`
Expected: FAIL — `available-capital` matches `/audit ruling/i` (the current `householdAdaptation` leak).

- [ ] **Step 3: Rewrite the file**

```ts
// src/lib/concepts/content/available-capital.ts
import type { FinancialConcept } from "../types";

export const availableCapital: FinancialConcept = {
  id: "available-capital",
  title: "Available capital",
  classification: "pfi_metric",
  shortDefinition:
    "Cash you can actually deploy: liquid assets minus revolving balances and obligations due before your next income.",
  plainEnglishSummary:
    "The money your household can safely put to work today, after subtracting revolving debt and obligations due before the next expected income.",
  memorableDistinction: "Cash that exists is not always cash that is free to use.",
  fullDefinition:
    "Available capital is the cash a household can actually deploy right now — liquid assets minus revolving balances and minus obligations due before the next expected income. It answers a more precise question than liquidity alone: not just how much cash exists, but how much of it is genuinely free to use after what's already committed against it.",
  whyItMatters:
    "Cash balances can overstate financial flexibility. A household can hold a sizable liquid balance and still have little room to act if much of it is offset by a revolving balance or an obligation coming due. Available capital separates money that exists from money that is genuinely free to use.",
  formula: "Liquid assets − revolving balances − near-term obligations = available capital",
  formulaRows: [
    { label: "Liquid assets" },
    { label: "Revolving balances", operator: "-" },
    { label: "Near-term obligations", operator: "-" },
    { label: "Available capital", operator: "=" },
  ],
  interpretation:
    "Available capital can fall while net worth rises — for example, when gains land in illiquid assets while near-term obligations grow. Read it as immediate flexibility, not overall wealth.",
  householdAdaptation:
    "Available capital is PFI's household measure of available financial position — the quantity your Personal Index, personal baseline, and financial waterline are computed from. It has no single direct corporate-accounting equivalent, so PFI keeps a distinct name for it.",
  businessContext:
    "Its closest business cousins are working capital and what investors sometimes call “dry powder” — cash a business or investor has on hand and free to deploy, net of near-term claims against it.",
  whereUsed: [
    "Home dashboard (Available capital card)",
    "Personal Index",
    "Personal baseline",
    "Financial waterline",
  ],
  relatedConceptIds: ["liquidity", "short-term-obligations", "financial-flexibility"],
  prerequisiteConceptIds: [],
  dataMetricKey: "position:availablePosition",
  status: "published",
};
```

(No lesson — glossary-only, unchanged. The "audit ruling, spec findings #6" leak is gone; `whereUsed` lists only implemented surfaces — no forecasting, no financial-condition analysis.)

- [ ] **Step 4: Run to verify pass + commit**

Run: `pnpm vitest run src/lib/concepts && pnpm typecheck && pnpm test`
Expected: all green.

```bash
git add src/lib/concepts/content/available-capital.ts src/lib/concepts/content.test.ts
git commit -m "content(concepts): Available Capital reference sheet — PFI-metric classification, visual formula, internal-language leak removed + guard test"
```

---

### Task 9: e2e updates, docs, full check, live verification

**Files:**
- Modify: `e2e/academy.spec.ts`
- Modify: `docs/DECISIONS.md` (append #35), `docs/CURRENT_PHASE.md`

- [ ] **Step 1: Update the e2e journey** in `e2e/academy.spec.ts`:

In **"the report's Revenue term offers Take the lesson and deep-links into it"**, after `const dialog = ...` add un-gating assertions, and replace the `Sample data` assertion (demo data is loaded by this point, so the household section is live):

```ts
  await expect(dialog.getByText("Standard finance term")).toBeVisible();
  await expect(dialog.getByText("Why it matters")).toBeVisible(); // un-gated pre-completion
  await expect(dialog.getByRole("link", { name: "Take the lesson" })).toBeVisible();
  await dialog.getByRole("link", { name: "Take the lesson" }).click();
  await page.waitForURL("**/academy/revenue");
  await expect(page.getByRole("heading", { name: "1. What is revenue?" })).toBeVisible();
  await expect(page.getByText("Not every deposit is revenue.")).toBeVisible(); // memorable distinction
  await expect(page.getByText("Calculated from your data")).toBeVisible();     // live household application
```

Insert a new test directly after it (the lesson is now in progress):

```ts
test("an in-progress lesson's term sheet offers Continue lesson", async () => {
  await page.goto("/report");
  await page.getByRole("button", { name: "Revenue — show definition" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "Continue lesson" })).toBeVisible();
  await dialog.getByRole("link", { name: "Continue lesson" }).click();
  await page.waitForURL("**/academy/revenue");
});
```

In **"answering all checks completes the lesson — right or wrong"**, after the completion assertion add:

```ts
  await expect(complete.getByRole("button", { name: "Review concept" })).toBeVisible();
```

In **"the term sheet unlocks the completed variant"** (rename the test to `"the completed term sheet deepens with the user's data"`), update assertions:

```ts
  await expect(dialog.getByText("Academy concept completed")).toBeVisible();
  await expect(dialog.getByText("Why it matters")).toBeVisible();
  await expect(dialog.getByText("Your data")).toBeVisible(); // completed live block (demo data present)
  await expect(dialog.getByRole("link", { name: "Review lesson" })).toBeVisible();
```

("Lesson completed" is now "Academy concept completed".)

In **"glossary-only row opens the definition sheet, not a lesson"** add:

```ts
  await expect(dialog.getByText("Why it matters")).toBeVisible(); // un-gated for glossary concepts too
```

Add a new test before the nested-interactive test (demo data is loaded by then):

```ts
test("Available capital's sheet is a labeled PFI metric with no internal language", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: "Available capital — show definition" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("PFI metric")).toBeVisible();
  await expect(dialog.getByText("Where it appears")).toBeVisible();
  await expect(dialog.getByText(/audit ruling|spec finding/i)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: fully green — the academy spec with its new assertions, and `smoke.spec.ts` / `password-auth.spec.ts` / `manifest.spec.ts` unaffected. (Reminder: run the full suite without `-g` filters; `smoke.spec.ts` is serial and session-state dependent.)

- [ ] **Step 3: DECISIONS.md entry #35** (append; match the existing `## N. date — title` format):

```markdown
## 35. 2026-07-21 — Academy content refinement Slice A: un-gated depth, classification, stable check ids

**Decision:** Definition-sheet depth (why-it-matters, business context, classification) shows at every progress state — completion adds only the live "Your data" block; the meaning of a term is never gated (the Slice 3 completed-variant gating is reversed per the content-refinement spec). Concepts carry a `classification` (standard finance term / household adaptation / PFI metric), a memorable distinction with included/excluded comparison rows, structured `formulaRows` (with plain-text `formula` kept as the accessible fallback), and `whereUsed`. Knowledge-check responses persist by stable `checkId` (not positional index) — changed pre-launch while `academy_progress` holds no real user data. Lessons keep fixed named fields (no generic sections array). Live household figures resolve through one shared `concept-live` resolver (report namespace first), consumed by the lesson page server-side and by the sheet lazily on open. Revenue and Available Capital are the two reference implementations; Slices B/C propagate the pattern.

**Alternatives:** keeping depth gated behind completion (contradicts "comprehension is never locked"); a generic lesson-sections array (unused machinery — every section already has a named field, and fixed fields keep content mechanically validatable); positional check indices (breaks silently when checks are reordered/edited); eager layout-level live-data fetch (a full report computation on every page load).

**Consequences:** the terminology/formula audit confirmed existing engine/content consistency (monthly surplus vs FCF, savings rate = retained cash ÷ revenue, net worth = equity, liquidity ≠ available capital) with one real fix — the "audit ruling, spec findings #6" internal language that rendered verbatim in the Available Capital sheet is removed and guarded by a content test. `getCompletedConceptIds` became `getAcademyStatusIds` (in-progress + completed) for the three-state CTA.
```

- [ ] **Step 4: Update CURRENT_PHASE.md** — header "Last updated" line, extend the **Phase:** chain (Slice A of the Academy content refinement complete), and replace the "Completed (this phase)" section with one bullet per task (1–9) with commit hashes, mirroring the Slice 3 section's density. Note Slices B (lessons rollout) and C (sheets rollout) as next up.

- [ ] **Step 5: Full check + live verification**

Run: `pnpm check`
Expected: lint, typecheck, unit tests, build all green.

Live-verify in `pnpm dev` at ~390px and desktop:
1. `/report` → Revenue sheet: classification label + business context at top, summary, why-it-matters visible pre-completion, structure-only formula block, "Where it appears", "Take the lesson".
2. `/academy/revenue`: distinction callout with comparison rows after section 1; "Sample figures" pill on the calculation; "Calculated from your data" (with demo data) or "Sample household" (without) on the household section; "How to read it"; misunderstanding callout; whereUsed list.
3. Complete the lesson (answer one check wrong): explanation shows, completion card shows the fluency summary + Review concept / Back to Academy / Next actions, no "analytical depth" copy anywhere.
4. Re-open the Revenue sheet: "Academy concept completed", "Your data" block with the current-month figure and delta, "Review lesson".
5. Home → Available capital sheet: "PFI metric" label, no internal language, formula block, "Where it appears".
6. An unmigrated concept (e.g. Assets sheet): still renders correctly via fallbacks (shortDefinition + fullDefinition, mono formula string, no whereUsed section).
7. No horizontal overflow at 390px; comparison rows stack; zero console errors.

- [ ] **Step 6: Commit**

```bash
git add e2e/academy.spec.ts docs/DECISIONS.md docs/CURRENT_PHASE.md
git commit -m "test(academy): content-refinement e2e coverage; docs: DECISIONS #35, phase update"
```

---

## Plan Self-Review (completed)

- **Spec coverage:** schema + classification (T1) ✓ · lesson renames + stable check ids incl. jsonb shape change (T2) ✓ · shared components (T3) ✓ · live-data resolver + lazy action, report namespace (T4) ✓ · un-gated sheet, three-state CTA, `getAcademyStatusIds`, completed live block (T5) ✓ · lesson framework upgrade + household application + completion card copy (T6) ✓ · Revenue reference (T7) ✓ · Available Capital reference + internal-language guard (T8) ✓ · e2e/docs/live verification incl. the spec's testing-requirements list items applicable to Slice A (T9) ✓ · audit findings recorded in spec + DECISIONS #35 ✓
- **Placeholders:** none — every code step carries complete code; the two "keep existing" content markers in early drafts were expanded to full text in T7/T8.
- **Type consistency:** `CheckResponse { checkId, choiceIndex }` used identically in T2 (progress/action/component), T5 (unchanged), T6 (props); `buildTermSheetModel(..., { progress })` matches T5's provider call; `ConceptLiveData` field names (`periodLabel/display/priorLabel/priorDisplay/deltaDisplay`) match across T4 resolver, T5 `ConceptLiveBlock`, T6 `HouseholdApplication`; `getAcademyStatusIds` return shape matches the provider's `academyStatus` prop.
