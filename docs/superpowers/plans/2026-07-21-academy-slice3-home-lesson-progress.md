# Academy Slice 3 Implementation Plan — home, lesson experience, knowledge checks, progress tracking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Academy learning loop — `/academy` home, `/academy/[conceptId]` lesson pages with knowledge checks, DB-backed per-user progress, completed/pre-completion term-sheet variants with lesson CTAs, a 5th bottom-nav tab, and the `MetricCard` nesting fix.

**Architecture:** Server-rendered routes + server actions + one `academy_progress` Supabase table (owner-only RLS), mirroring `/score` and `/report`. All derivation logic (status, tallies, next-up, answer validation) lives framework-free in `src/lib/concepts/progress.ts`; status is always derived, never stored. The term sheet gains a `{ completed }` input on `buildTermSheetModel`.

**Tech Stack:** Next.js 16 App Router, strict TypeScript, Tailwind 4 tokens, Supabase (RLS), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-21-academy-slice3-home-lesson-progress-design.md`

## Global Constraints

- Migration numbering: next free number is **0012** (0011 is driver_explanations_surface).
- `src/lib/concepts/` stays framework-free — no React/Next imports in `progress.ts` or `term-sheet.ts`.
- Registry/content untouched: `src/lib/concepts/content/`, `registry.ts`, `types.ts`, `modules.ts` are not modified.
- Correctness of knowledge-check answers is **never stored** — derived from the registry (deterministic code calculates). Completion never requires a correct answer.
- No streaks, no locks, no fluency ladder, no filter chips. States are exactly: Not started / In progress / Completed.
- Never color alone: every state icon is paired with text; the correct answer is marked with icon + text.
- No shame language; explanations teach on right and wrong answers alike.
- Mobile-first: verify at ~390px before desktop.
- `pnpm check` (lint + typecheck + test + build) green before any completion claim. Worktree note: copy `.env.local` from the main checkout into the worktree first or the build fails on missing Supabase env vars.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration — `academy_progress` table + RLS suite

**Files:**
- Create: `supabase/migrations/0012_academy_progress.sql`
- Modify: `scripts/test-rls.mts` (append a section after the existing `ai_narrations` block, which ends near line 280)

**Interfaces:**
- Produces: table `public.academy_progress` with columns `user_id uuid`, `concept_id text`, `started_at timestamptz`, `completed_at timestamptz | null`, `check_responses jsonb` (array of `{ checkIndex, choiceIndex }`), PK `(user_id, concept_id)`. Later tasks upsert/select it.

- [ ] **Step 1: Write the migration**

```sql
-- 0012_academy_progress.sql
-- Academy Slice 3 (docs/superpowers/specs/2026-07-21-academy-slice3-home-lesson-progress-design.md):
-- per-user lesson progress. Status is always DERIVED, never stored: no row =
-- not started, row = in progress, completed_at set = completed.
-- check_responses is a jsonb array of { checkIndex, choiceIndex } — raw
-- responses only; correctness is derivable from the compile-time registry and
-- is never persisted. concept_id has no FK (concepts live in code); server
-- actions validate ids against the published lesson-bearing registry set.
-- No cross-table FK beyond user_id, so no ownership trigger is needed
-- (contrast balance_anchors, DECISIONS #25).

create table public.academy_progress (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  concept_id text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check_responses jsonb not null default '[]',
  primary key (user_id, concept_id)
);

alter table public.academy_progress enable row level security;

create policy "own_select" on public.academy_progress for select using (auth.uid() = user_id);
create policy "own_insert" on public.academy_progress for insert with check (auth.uid() = user_id);
create policy "own_update" on public.academy_progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.academy_progress for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply to the linked project**

Run: `supabase db push`
Expected: `0012_academy_progress.sql` applied without error.

- [ ] **Step 3: Extend the RLS suite**

Append after the `ai_narrations` section of `scripts/test-rls.mts` (mirror its style; `a`/`b` are the two authed test users and `check` the assertion helper already in scope):

```ts
  // academy_progress: owner-only Academy lesson progress (Slice 3).
  const progressRow = { user_id: a.id, concept_id: "revenue", check_responses: [] };
  const { error: apIns } = await a.client.from("academy_progress").insert(progressRow);
  check("A can insert own academy progress", !apIns, apIns?.message);

  const { data: apOwn } = await a.client.from("academy_progress").select("concept_id").eq("user_id", a.id);
  check("A can read own academy progress", (apOwn?.length ?? 0) === 1);

  const { data: apCross } = await b.client.from("academy_progress").select("concept_id");
  check("B cannot read A's academy progress", (apCross?.length ?? 0) === 0);

  const { error: apForge } = await b.client.from("academy_progress")
    .insert({ ...progressRow, concept_id: "assets" });
  check("B cannot insert academy progress for A", !!apForge);

  const { data: apUpd } = await b.client.from("academy_progress")
    .update({ completed_at: new Date().toISOString() }).eq("user_id", a.id).select("concept_id");
  check("B cannot update A's academy progress", (apUpd?.length ?? 0) === 0);

  const { data: apDel } = await b.client.from("academy_progress")
    .delete().eq("user_id", a.id).select("concept_id");
  check("B cannot delete A's academy progress", (apDel?.length ?? 0) === 0);
```

- [ ] **Step 4: Run the RLS suite**

Run: `pnpm test:rls`
Expected: all checks pass, including the six new `academy progress` lines.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_academy_progress.sql scripts/test-rls.mts
git commit -m "feat(academy): academy_progress table with owner-only RLS"
```

---

### Task 2: Framework-free progress derivations — `src/lib/concepts/progress.ts`

**Files:**
- Create: `src/lib/concepts/progress.ts`
- Test: `src/lib/concepts/progress.test.ts`

**Interfaces:**
- Consumes: `ConceptRegistry` (`registry.ts`), `CONCEPT_REGISTRY` (`index.ts`), types from `types.ts`.
- Produces (exact signatures later tasks import):
  - `interface CheckResponse { checkIndex: number; choiceIndex: number }`
  - `interface ProgressRow { conceptId: ConceptId; startedAt: string; completedAt: string | null; checkResponses: CheckResponse[] }`
  - `type ConceptProgressStatus = "not-started" | "in-progress" | "completed"`
  - `conceptStatus(row: ProgressRow | undefined): ConceptProgressStatus`
  - `lessonSequence(registry: ConceptRegistry): ConceptId[]`
  - `interface AcademyTallies { lessonsCompleted: number; lessonsTotal: number; modulesCompleted: number; modulesTotal: number; percentComplete: number }`
  - `academyTallies(registry: ConceptRegistry, rows: ProgressRow[]): AcademyTallies`
  - `nextUpLesson(registry: ConceptRegistry, rows: ProgressRow[]): FinancialConcept | null`
  - `interface RecentCompletion { conceptId: ConceptId; title: string; completedAt: string }`
  - `recentlyCompleted(registry: ConceptRegistry, rows: ProgressRow[], limit?: number): RecentCompletion[]`
  - `adjacentLessons(registry: ConceptRegistry, conceptId: ConceptId): { prev: ConceptId | null; next: ConceptId | null }`
  - `lessonConcept(registry: ConceptRegistry, conceptId: string): FinancialConcept | null`
  - `validateCheckAnswer(registry: ConceptRegistry, conceptId: string, checkIndex: number, choiceIndex: number): string | null`
  - `appendCheckResponse(totalChecks: number, responses: CheckResponse[], response: CheckResponse): { responses: CheckResponse[]; allAnswered: boolean; duplicate: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/concepts/progress.test.ts
import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import {
  academyTallies, adjacentLessons, appendCheckResponse, conceptStatus,
  lessonConcept, lessonSequence, nextUpLesson, recentlyCompleted,
  validateCheckAnswer, type ProgressRow,
} from "./progress";

const row = (conceptId: string, over: Partial<ProgressRow> = {}): ProgressRow => ({
  conceptId, startedAt: "2026-07-21T00:00:00Z", completedAt: null, checkResponses: [], ...over,
});
const done = (conceptId: string, at = "2026-07-21T01:00:00Z") =>
  row(conceptId, { completedAt: at });

describe("conceptStatus", () => {
  it("derives all three states", () => {
    expect(conceptStatus(undefined)).toBe("not-started");
    expect(conceptStatus(row("revenue"))).toBe("in-progress");
    expect(conceptStatus(done("revenue"))).toBe("completed");
  });
});

describe("lessonSequence", () => {
  it("is the 10 lesson-bearing published concepts in module order", () => {
    const seq = lessonSequence(CONCEPT_REGISTRY);
    expect(seq).toHaveLength(10);
    expect(seq[0]).toBe("revenue"); // module 1 starts the curriculum
    // glossary-only records never appear
    for (const id of ["short-term-obligations", "financial-flexibility", "retained-cash", "capital-allocation", "available-capital"]) {
      expect(seq).not.toContain(id);
    }
    // every entry has a lesson
    for (const id of seq) expect(CONCEPT_REGISTRY.byId(id)?.lesson).toBeTruthy();
  });
});

describe("academyTallies", () => {
  it("zero progress", () => {
    expect(academyTallies(CONCEPT_REGISTRY, [])).toEqual({
      lessonsCompleted: 0, lessonsTotal: 10, modulesCompleted: 0, modulesTotal: 3, percentComplete: 0,
    });
  });
  it("partial progress; in-progress rows do not count as completed", () => {
    const t = academyTallies(CONCEPT_REGISTRY, [done("revenue"), row("cash-flow")]);
    expect(t.lessonsCompleted).toBe(1);
    expect(t.modulesCompleted).toBe(0);
    expect(t.percentComplete).toBe(10);
  });
  it("a module completes when all its lesson-bearing concepts complete", () => {
    const module1 = ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"];
    const t = academyTallies(CONCEPT_REGISTRY, module1.map((id) => done(id)));
    expect(t.modulesCompleted).toBe(1); // module 3's glossary-only records don't block anything
  });
});

describe("nextUpLesson", () => {
  it("is the first not-completed lesson in module order", () => {
    expect(nextUpLesson(CONCEPT_REGISTRY, [])?.id).toBe("revenue");
    expect(nextUpLesson(CONCEPT_REGISTRY, [done("revenue")])?.id).toBe("operating-expenses");
  });
  it("skips over later completions and returns null when everything is done", () => {
    const seq = lessonSequence(CONCEPT_REGISTRY);
    expect(nextUpLesson(CONCEPT_REGISTRY, [done(seq[1]!)])?.id).toBe(seq[0]);
    expect(nextUpLesson(CONCEPT_REGISTRY, seq.map((id) => done(id)))).toBeNull();
  });
});

describe("recentlyCompleted", () => {
  it("returns newest-first, capped, completed-only", () => {
    const rows = [
      done("revenue", "2026-07-18T00:00:00Z"),
      done("assets", "2026-07-20T00:00:00Z"),
      done("cash-flow", "2026-07-19T00:00:00Z"),
      done("net-worth", "2026-07-17T00:00:00Z"),
      row("liquidity"), // in progress — excluded
    ];
    expect(recentlyCompleted(CONCEPT_REGISTRY, rows).map((r) => r.conceptId))
      .toEqual(["assets", "cash-flow", "revenue"]);
  });
});

describe("adjacentLessons", () => {
  it("walks module order across boundaries and clamps the ends", () => {
    const seq = lessonSequence(CONCEPT_REGISTRY);
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[0]!)).toEqual({ prev: null, next: seq[1] });
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[5]!)).toEqual({ prev: seq[4], next: seq[6] });
    expect(adjacentLessons(CONCEPT_REGISTRY, seq[9]!)).toEqual({ prev: seq[8], next: null });
    expect(adjacentLessons(CONCEPT_REGISTRY, "short-term-obligations")).toEqual({ prev: null, next: null });
  });
});

describe("lessonConcept", () => {
  it("returns published lesson-bearing concepts only", () => {
    expect(lessonConcept(CONCEPT_REGISTRY, "revenue")?.id).toBe("revenue");
    expect(lessonConcept(CONCEPT_REGISTRY, "short-term-obligations")).toBeNull(); // glossary-only
    expect(lessonConcept(CONCEPT_REGISTRY, "no-such-concept")).toBeNull();
  });
});

describe("validateCheckAnswer", () => {
  it("accepts a valid answer", () => {
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", 0, 0)).toBeNull();
  });
  it("rejects unknown/glossary-only lessons and out-of-bounds indices", () => {
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "no-such-concept", 0, 0)).toBe("Unknown lesson");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "short-term-obligations", 0, 0)).toBe("Unknown lesson");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", 99, 0)).toBe("Unknown knowledge check");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", -1, 0)).toBe("Unknown knowledge check");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", 0, 99)).toBe("Unknown choice");
    expect(validateCheckAnswer(CONCEPT_REGISTRY, "revenue", 0.5, 0)).toBe("Unknown knowledge check");
  });
});

describe("appendCheckResponse", () => {
  it("appends and reports allAnswered when every check has a response", () => {
    const first = appendCheckResponse(2, [], { checkIndex: 0, choiceIndex: 1 });
    expect(first).toEqual({ responses: [{ checkIndex: 0, choiceIndex: 1 }], allAnswered: false, duplicate: false });
    const second = appendCheckResponse(2, first.responses, { checkIndex: 1, choiceIndex: 0 });
    expect(second.allAnswered).toBe(true);
  });
  it("first answer wins; duplicates are ignored", () => {
    const prior = [{ checkIndex: 0, choiceIndex: 1 }];
    const dup = appendCheckResponse(2, prior, { checkIndex: 0, choiceIndex: 2 });
    expect(dup).toEqual({ responses: prior, allAnswered: false, duplicate: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/concepts/progress.test.ts`
Expected: FAIL — `Cannot find module './progress'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/concepts/progress.ts
// Framework-free (no React/Next). Derives Academy progress state from the
// registry + academy_progress rows. Status is always derived, never stored;
// answer correctness is never persisted (deterministic code calculates).
// Spec: docs/superpowers/specs/2026-07-21-academy-slice3-home-lesson-progress-design.md
import type { ConceptRegistry } from "./registry";
import type { ConceptId, FinancialConcept } from "./types";

export interface CheckResponse {
  checkIndex: number;
  choiceIndex: number;
}

export interface ProgressRow {
  conceptId: ConceptId;
  startedAt: string; // ISO timestamp
  completedAt: string | null;
  checkResponses: CheckResponse[];
}

export type ConceptProgressStatus = "not-started" | "in-progress" | "completed";

export function conceptStatus(row: ProgressRow | undefined): ConceptProgressStatus {
  if (!row) return "not-started";
  return row.completedAt ? "completed" : "in-progress";
}

/** The canonical lesson order: published lesson-bearing concept ids, module by module. */
export function lessonSequence(registry: ConceptRegistry): ConceptId[] {
  return registry.modules.flatMap((m) =>
    m.conceptIds.filter((id) => {
      const c = registry.byId(id);
      return !!c && c.status === "published" && !!c.lesson;
    }),
  );
}

export interface AcademyTallies {
  lessonsCompleted: number;
  lessonsTotal: number;
  modulesCompleted: number;
  modulesTotal: number;
  percentComplete: number; // 0–100, rounded
}

export function academyTallies(registry: ConceptRegistry, rows: ProgressRow[]): AcademyTallies {
  const byId = new Map(rows.map((r) => [r.conceptId, r]));
  const seq = lessonSequence(registry);
  const lessonSet = new Set(seq);
  const lessonsCompleted = seq.filter((id) => conceptStatus(byId.get(id)) === "completed").length;
  const modulesCompleted = registry.modules.filter((m) => {
    const lessons = m.conceptIds.filter((id) => lessonSet.has(id));
    return lessons.length > 0 && lessons.every((id) => conceptStatus(byId.get(id)) === "completed");
  }).length;
  return {
    lessonsCompleted,
    lessonsTotal: seq.length,
    modulesCompleted,
    modulesTotal: registry.modules.length,
    percentComplete: seq.length === 0 ? 0 : Math.round((lessonsCompleted / seq.length) * 100),
  };
}

/** First not-completed lesson in module order; null when the curriculum is done. */
export function nextUpLesson(registry: ConceptRegistry, rows: ProgressRow[]): FinancialConcept | null {
  const byId = new Map(rows.map((r) => [r.conceptId, r]));
  const id = lessonSequence(registry).find((i) => conceptStatus(byId.get(i)) !== "completed");
  return id ? (registry.byId(id) ?? null) : null;
}

export interface RecentCompletion {
  conceptId: ConceptId;
  title: string;
  completedAt: string;
}

export function recentlyCompleted(
  registry: ConceptRegistry,
  rows: ProgressRow[],
  limit = 3,
): RecentCompletion[] {
  return rows
    .filter((r): r is ProgressRow & { completedAt: string } => r.completedAt !== null)
    .flatMap((r) => {
      const c = registry.byId(r.conceptId);
      return c && c.status === "published"
        ? [{ conceptId: r.conceptId, title: c.title, completedAt: r.completedAt }]
        : [];
    })
    .sort((x, y) => (x.completedAt < y.completedAt ? 1 : -1))
    .slice(0, limit);
}

export function adjacentLessons(
  registry: ConceptRegistry,
  conceptId: ConceptId,
): { prev: ConceptId | null; next: ConceptId | null } {
  const seq = lessonSequence(registry);
  const i = seq.indexOf(conceptId);
  if (i === -1) return { prev: null, next: null };
  return { prev: seq[i - 1] ?? null, next: seq[i + 1] ?? null };
}

/** The concept a lesson route may render: published AND lesson-bearing, else null (→ notFound). */
export function lessonConcept(registry: ConceptRegistry, conceptId: string): FinancialConcept | null {
  const c = registry.byId(conceptId);
  return c && c.status === "published" && c.lesson ? c : null;
}

/** Server-action guard. Returns a human-readable error, or null when recordable. */
export function validateCheckAnswer(
  registry: ConceptRegistry,
  conceptId: string,
  checkIndex: number,
  choiceIndex: number,
): string | null {
  const c = lessonConcept(registry, conceptId);
  if (!c) return "Unknown lesson";
  const checks = c.lesson!.knowledgeCheck;
  if (!Number.isInteger(checkIndex) || checkIndex < 0 || checkIndex >= checks.length) {
    return "Unknown knowledge check";
  }
  const check = checks[checkIndex]!;
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
  const duplicate = responses.some((r) => r.checkIndex === response.checkIndex);
  const next = duplicate ? responses : [...responses, response];
  const answered = new Set(next.map((r) => r.checkIndex));
  return { responses: next, allAnswered: answered.size >= totalChecks, duplicate };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/concepts/progress.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Re-export from the barrel**

Append to `src/lib/concepts/index.ts` (mirror its existing export style):

```ts
export {
  academyTallies, adjacentLessons, appendCheckResponse, conceptStatus,
  lessonConcept, lessonSequence, nextUpLesson, recentlyCompleted, validateCheckAnswer,
} from "./progress";
export type {
  AcademyTallies, CheckResponse, ConceptProgressStatus, ProgressRow, RecentCompletion,
} from "./progress";
```

- [ ] **Step 6: Full unit suite + commit**

Run: `pnpm test`
Expected: PASS, no regressions.

```bash
git add src/lib/concepts/progress.ts src/lib/concepts/progress.test.ts src/lib/concepts/index.ts
git commit -m "feat(academy): framework-free progress derivations (status, tallies, next-up, answer guards)"
```

---

### Task 3: Term-sheet completed variant — `buildTermSheetModel({ completed })`

**Files:**
- Modify: `src/lib/concepts/term-sheet.ts`
- Test: `src/lib/concepts/term-sheet.test.ts` (extend the existing file)

**Interfaces:**
- Produces: `TermSheetModel` gains `hasLesson: boolean`, `completed: boolean`, `whyItMatters?: string`, `businessContext?: string`. `buildTermSheetModel(registry, conceptId, opts?: { completed?: boolean })` — third param optional so Slice 2 call sites keep compiling.

- [ ] **Step 1: Write the failing tests** (append to `term-sheet.test.ts`)

```ts
describe("completed variant (Slice 3)", () => {
  it("defaults to pre-completion: no depth fields, completed false", () => {
    const m = buildTermSheetModel(CONCEPT_REGISTRY, "revenue");
    expect(m?.hasLesson).toBe(true);
    expect(m?.completed).toBe(false);
    expect(m?.whyItMatters).toBeUndefined();
    expect(m?.businessContext).toBeUndefined();
  });

  it("completed unlocks whyItMatters and businessContext", () => {
    const m = buildTermSheetModel(CONCEPT_REGISTRY, "revenue", { completed: true });
    const c = CONCEPT_REGISTRY.byId("revenue")!;
    expect(m?.completed).toBe(true);
    expect(m?.whyItMatters).toBe(c.whyItMatters);
    expect(m?.businessContext).toBe(c.businessContext);
  });

  it("glossary-only concepts never report a lesson or completion", () => {
    const m = buildTermSheetModel(CONCEPT_REGISTRY, "short-term-obligations", { completed: true });
    expect(m?.hasLesson).toBe(false);
    expect(m?.completed).toBe(false);
    expect(m?.whyItMatters).toBeUndefined();
  });
});
```

(Reuse the file's existing imports; add `describe` if not imported.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/concepts/term-sheet.test.ts`
Expected: FAIL — `hasLesson`/`completed` undefined.

- [ ] **Step 3: Implement**

In `src/lib/concepts/term-sheet.ts`, extend the interface and builder:

```ts
export interface TermSheetModel {
  id: ConceptId;
  title: string;
  shortDefinition: string;
  fullDefinition: string;
  formula?: string;
  householdAdaptation?: string;
  related: TermSheetRelated[];
  /** Slice 3: lesson CTA + completed ("analytical depth") variant. */
  hasLesson: boolean;
  completed: boolean;
  whyItMatters?: string;   // present only when completed
  businessContext?: string; // present only when completed
}

export function buildTermSheetModel(
  registry: ConceptRegistry,
  conceptId: ConceptId,
  opts?: { completed?: boolean },
): TermSheetModel | null {
  const c = registry.byId(conceptId);
  if (!c || c.status !== "published") return null;

  const related: TermSheetRelated[] = c.relatedConceptIds
    .map((id) => registry.byId(id))
    .filter((r): r is FinancialConcept => !!r && r.status === "published")
    .map((r) => ({ id: r.id, title: r.title }));

  const hasLesson = !!c.lesson;
  const completed = hasLesson && !!opts?.completed; // glossary-only records can never complete

  return {
    id: c.id,
    title: c.title,
    shortDefinition: c.shortDefinition,
    fullDefinition: c.fullDefinition,
    formula: c.formula,
    householdAdaptation: c.householdAdaptation,
    related,
    hasLesson,
    completed,
    whyItMatters: completed ? c.whyItMatters : undefined,
    businessContext: completed ? c.businessContext : undefined,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/concepts/term-sheet.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean (third param is optional, existing callers unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts/term-sheet.ts src/lib/concepts/term-sheet.test.ts
git commit -m "feat(academy): term-sheet completed variant — hasLesson/completed + unlocked depth fields"
```

---

### Task 4: Queries + server actions

**Files:**
- Modify: `src/lib/data/queries.ts` (append after `getRecurringData`)
- Create: `src/app/actions/academy.ts`

**Interfaces:**
- Consumes: `ProgressRow`, `CheckResponse`, `appendCheckResponse`, `lessonConcept`, `validateCheckAnswer` (Task 2); `CONCEPT_REGISTRY`.
- Produces:
  - `getAcademyProgress(supabase): Promise<{ rows: ProgressRow[]; error: string | null }>` — error is non-null on query failure (pages render Not-started + notice, never fake completion).
  - `getCompletedConceptIds(supabase): Promise<string[]>` — `[]` for signed-out users or on error.
  - `startLesson(conceptId: string): Promise<{ error: string }>`
  - `answerKnowledgeCheck(conceptId: string, checkIndex: number, choiceIndex: number): Promise<{ error: string; responses?: CheckResponse[]; completed?: boolean }>`

- [ ] **Step 1: Add the queries** (append to `src/lib/data/queries.ts`)

```ts
// ---------- Academy (Slice 3) ----------

import type { CheckResponse, ProgressRow } from "@/lib/concepts/progress";
// (move this import to the top of the file with the other imports)

export interface AcademyProgressResult {
  rows: ProgressRow[];
  /** Non-null when the query failed: render Not-started + a notice, never fake completion. */
  error: string | null;
}

/** All of the user's academy_progress rows. Row count is bounded by the
 *  15-concept registry, so no pagination is needed (DECISIONS #21 audit). */
export async function getAcademyProgress(supabase: SupabaseClient): Promise<AcademyProgressResult> {
  const { data, error } = await supabase
    .from("academy_progress")
    .select("concept_id, started_at, completed_at, check_responses");
  if (error) return { rows: [], error: error.message };
  return {
    rows: (data ?? []).map((r) => ({
      conceptId: r.concept_id as string,
      startedAt: r.started_at as string,
      completedAt: (r.completed_at as string | null) ?? null,
      checkResponses: (r.check_responses as CheckResponse[] | null) ?? [],
    })),
    error: null,
  };
}

/** Completed concept ids for the term-sheet variant. [] when signed out or on error
 *  (the sheet then shows the pre-completion variant — the safe degradation). */
export async function getCompletedConceptIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("academy_progress")
    .select("concept_id")
    .not("completed_at", "is", null);
  if (error) return [];
  return (data ?? []).map((r) => r.concept_id as string);
}
```

- [ ] **Step 2: Write the server actions**

```ts
// src/app/actions/academy.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import {
  appendCheckResponse, lessonConcept, validateCheckAnswer, type CheckResponse,
} from "@/lib/concepts/progress";

/** Upsert the in-progress row. Idempotent — re-opening a lesson is a no-op. */
export async function startLesson(conceptId: string): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!lessonConcept(CONCEPT_REGISTRY, conceptId)) return { error: "Unknown lesson" };

  const { error } = await supabase.from("academy_progress").upsert(
    { user_id: user.id, concept_id: conceptId },
    { onConflict: "user_id,concept_id", ignoreDuplicates: true },
  );
  if (error) return { error: error.message };
  revalidatePath("/academy");
  return { error: "" };
}

export interface AnswerResult {
  error: string;
  responses?: CheckResponse[];
  completed?: boolean;
}

/**
 * Record one knowledge-check answer. First answer per check wins; when every
 * check of the lesson has a response, completed_at is set in the same call —
 * right or wrong (checks teach, never gate; spec §Product decisions #4).
 */
export async function answerKnowledgeCheck(
  conceptId: string,
  checkIndex: number,
  choiceIndex: number,
): Promise<AnswerResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const invalid = validateCheckAnswer(CONCEPT_REGISTRY, conceptId, checkIndex, choiceIndex);
  if (invalid) return { error: invalid };
  const concept = lessonConcept(CONCEPT_REGISTRY, conceptId)!;

  // RLS scopes the read to the caller's own rows.
  const { data: row, error: readErr } = await supabase
    .from("academy_progress")
    .select("check_responses, completed_at")
    .eq("concept_id", conceptId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const prior = (row?.check_responses as CheckResponse[] | null) ?? [];
  const { responses, allAnswered, duplicate } = appendCheckResponse(
    concept.lesson!.knowledgeCheck.length,
    prior,
    { checkIndex, choiceIndex },
  );
  if (duplicate) return { error: "", responses: prior, completed: !!row?.completed_at };

  const completedAt = row?.completed_at ?? (allAnswered ? new Date().toISOString() : null);
  const { error: writeErr } = await supabase.from("academy_progress").upsert(
    { user_id: user.id, concept_id: conceptId, check_responses: responses, completed_at: completedAt },
    { onConflict: "user_id,concept_id" },
  );
  if (writeErr) return { error: writeErr.message };

  if (completedAt && !row?.completed_at) {
    // Completion changes the layout-level completed-ids fetch (term-sheet variant).
    revalidatePath("/", "layout");
  } else {
    revalidatePath("/academy");
  }
  return { error: "", responses, completed: !!completedAt };
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: both clean (action logic is the Task-2-tested pure helpers plus thin I/O, matching how other actions in this repo are covered).

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/queries.ts src/app/actions/academy.ts
git commit -m "feat(academy): progress queries and startLesson/answerKnowledgeCheck server actions"
```

---

### Task 5: Bottom-nav Academy tab

**Files:**
- Modify: `src/components/nav/BottomNav.tsx`

**Interfaces:**
- Produces: an "Academy" tab at `/academy`, active for `/academy` and every nested lesson route.

- [ ] **Step 1: Add the tab and nested-route active state**

In `src/components/nav/BottomNav.tsx`:

```tsx
import { BarChart3, FileText, GraduationCap, Home, Trophy } from "lucide-react";

const tabs = [
  { href: "/", label: "Home", icon: Home },
  { href: "/rankings", label: "Rankings", icon: Trophy },
  { href: "/data", label: "Data", icon: BarChart3 },
  { href: "/report", label: "Report", icon: FileText },
  { href: "/academy", label: "Academy", icon: GraduationCap },
] as const;
```

Replace the active check (exact-match only misses `/academy/revenue`):

```tsx
const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
```

And tighten the item padding so five tabs fit at 390px: change `px-4` to `px-3` on the `Link` className.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. (Visual 390px verification happens in Task 10 with the rest of the UI.)

- [ ] **Step 3: Commit**

```bash
git add src/components/nav/BottomNav.tsx
git commit -m "feat(academy): Academy bottom-nav tab with nested-route active state"
```

---

### Task 6: Academy home — components, page, loading skeleton

**Files:**
- Create: `src/components/academy/ProgressRing.tsx`
- Create: `src/components/academy/ConceptRow.tsx`
- Create: `src/components/academy/AcademyHome.tsx`
- Create: `src/app/academy/page.tsx`
- Create: `src/app/academy/loading.tsx`

**Interfaces:**
- Consumes: Task 2 derivations, Task 4 `getAcademyProgress`, Slice 2 `useTermSheet`.
- Produces: `AcademyHome({ rows, degraded }: { rows: ProgressRow[]; degraded: boolean })`; `ConceptRow` and `ProgressRing` as below. Task 10's e2e relies on: heading "Academy", text `X of 10 lessons`, link "Continue", per-row status text, "Recently completed" heading.

- [ ] **Step 1: ProgressRing (decorative; numbers always rendered beside it)**

```tsx
// src/components/academy/ProgressRing.tsx
/** Decorative progress ring — always paired with explicit numbers (never color/shape alone). */
export function ProgressRing({ percent, size = 56 }: { percent: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
        stroke="currentColor" className="text-elevated-2"
      />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        stroke="currentColor" className="text-positive"
        strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)}
      />
    </svg>
  );
}
```

- [ ] **Step 2: ConceptRow (client — glossary rows open the term sheet)**

```tsx
// src/components/academy/ConceptRow.tsx
"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight, CircleDot } from "lucide-react";
import { useTermSheet } from "@/components/concepts/TermSheetProvider";
import type { ConceptId } from "@/lib/concepts";
import type { ConceptProgressStatus } from "@/lib/concepts/progress";

const STATUS: Record<ConceptProgressStatus, { label: string; Icon: typeof CheckCircle2; tone: string }> = {
  completed: { label: "Completed", Icon: CheckCircle2, tone: "text-positive" },
  "in-progress": { label: "In progress", Icon: CircleDot, tone: "text-primary" },
  "not-started": { label: "Not started", Icon: ChevronRight, tone: "text-tertiary" },
};

export function ConceptRow({
  conceptId, title, shortDefinition, hasLesson, status, buildsOn,
}: {
  conceptId: ConceptId;
  title: string;
  shortDefinition: string;
  hasLesson: boolean;
  status: ConceptProgressStatus;
  buildsOn: string[];
}) {
  const { openTerm } = useTermSheet();
  const { label, Icon, tone } = STATUS[status];

  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-primary">{title}</span>
        <span className="truncate text-xs text-secondary">{shortDefinition}</span>
        {buildsOn.length > 0 && (
          <span className="mt-0.5 text-[11px] text-tertiary">Builds on: {buildsOn.join(", ")}</span>
        )}
      </span>
      {hasLesson ? (
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${tone}`}>
          <Icon size={14} aria-hidden />
          {label}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-tertiary">Definition</span>
      )}
    </>
  );

  const rowClass =
    "flex w-full items-center gap-3 rounded-xl border border-border-subtle bg-inset p-3 text-left transition-colors hover:border-border-strong";

  return hasLesson ? (
    <Link href={`/academy/${conceptId}`} className={rowClass}>{body}</Link>
  ) : (
    <button type="button" onClick={() => openTerm(conceptId)} className={rowClass}>{body}</button>
  );
}
```

- [ ] **Step 3: AcademyHome (server component; small internal sections)**

```tsx
// src/components/academy/AcademyHome.tsx
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import {
  academyTallies, conceptStatus, nextUpLesson, recentlyCompleted, type ProgressRow,
} from "@/lib/concepts/progress";
import { ConceptRow } from "./ConceptRow";
import { ProgressRing } from "./ProgressRing";

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function AcademyHome({ rows, degraded }: { rows: ProgressRow[]; degraded: boolean }) {
  const byId = new Map(rows.map((r) => [r.conceptId, r]));
  const tallies = academyTallies(CONCEPT_REGISTRY, rows);
  const nextUp = nextUpLesson(CONCEPT_REGISTRY, rows);
  const recent = recentlyCompleted(CONCEPT_REGISTRY, rows);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Academy</h1>
        <p className="mt-1 text-sm text-secondary">Master the language of finance.</p>
      </header>

      {degraded && (
        <p role="status" className="rounded-xl border border-border-subtle bg-inset p-3 text-xs text-secondary">
          Progress couldn&apos;t be loaded right now, so lessons are shown as not started. Your saved
          progress is unaffected.
        </p>
      )}

      <Card className="flex items-center gap-4 p-4">
        <ProgressRing percent={tallies.percentComplete} />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-primary">
            {tallies.lessonsCompleted} of {tallies.lessonsTotal} lessons
          </p>
          <p className="text-xs text-secondary">
            {tallies.modulesCompleted} of {tallies.modulesTotal} modules · {tallies.percentComplete}% complete
          </p>
        </div>
      </Card>

      {nextUp ? (
        <Card className="flex flex-col gap-2 p-4">
          <p className="text-xs font-medium tracking-wide text-tertiary uppercase">Continue learning</p>
          <p className="text-sm font-semibold text-primary">{nextUp.title}</p>
          <p className="text-xs text-secondary">{nextUp.shortDefinition}</p>
          <Link
            href={`/academy/${nextUp.id}`}
            className="mt-1 self-start rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-border-strong"
          >
            Continue
          </Link>
        </Card>
      ) : (
        <Card className="flex items-center gap-2 p-4">
          <CheckCircle2 size={16} aria-hidden className="text-positive" />
          <p className="text-sm text-primary">All lessons complete — every term now shows its full depth.</p>
        </Card>
      )}

      {CONCEPT_REGISTRY.modules.map((m) => (
        <section key={m.id} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-primary">
            Module {m.order} — {m.title}
          </h2>
          {CONCEPT_REGISTRY.forModule(m.id)
            .filter((c) => c.status === "published")
            .map((c) => (
              <ConceptRow
                key={c.id}
                conceptId={c.id}
                title={c.title}
                shortDefinition={c.shortDefinition}
                hasLesson={!!c.lesson}
                status={c.lesson ? conceptStatus(byId.get(c.id)) : "not-started"}
                buildsOn={c.prerequisiteConceptIds
                  .map((id) => CONCEPT_REGISTRY.byId(id)?.title)
                  .filter((t): t is string => !!t)}
              />
            ))}
        </section>
      ))}

      {recent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-primary">Recently completed</h2>
          {recent.map((r) => (
            <div key={r.conceptId} className="flex items-center justify-between rounded-xl border border-border-subtle bg-inset p-3">
              <span className="flex items-center gap-2 text-sm text-primary">
                <CheckCircle2 size={14} aria-hidden className="text-positive" />
                {r.title}
              </span>
              <span className="text-xs text-tertiary">{formatDay(r.completedAt)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Page + loading skeleton**

```tsx
// src/app/academy/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAcademyProgress, getProfile } from "@/lib/data/queries";
import { AcademyHome } from "@/components/academy/AcademyHome";

export default async function AcademyPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");

  const { rows, error } = await getAcademyProgress(supabase);
  return <AcademyHome rows={rows} degraded={error !== null} />;
}
```

```tsx
// src/app/academy/loading.tsx
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading Academy" role="status">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-36 rounded bg-elevated" />
        <div className="h-4 w-56 rounded bg-elevated" />
      </div>
      <div className="h-24 rounded-card bg-elevated" />
      <div className="h-28 rounded-card bg-elevated" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-4 w-64 rounded bg-elevated" />
          {[0, 1, 2].map((j) => <div key={j} className="h-16 rounded-xl bg-elevated" />)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. Then `pnpm dev`, sign in, open `http://localhost:3000/academy`: progress card shows "0 of 10 lessons", three module sections render, glossary rows show "Definition" and open the term sheet, no padlocks anywhere.

- [ ] **Step 6: Commit**

```bash
git add src/components/academy src/app/academy
git commit -m "feat(academy): Academy home — progress card, continue card, module concept rows"
```

---

### Task 7: Lesson experience — sections, knowledge checks, tabs, pager

**Files:**
- Create: `src/components/academy/LessonSections.tsx`
- Create: `src/components/academy/KnowledgeChecks.tsx`
- Create: `src/components/academy/LessonView.tsx`
- Create: `src/app/academy/[conceptId]/page.tsx`
- Create: `src/app/academy/[conceptId]/loading.tsx`

**Interfaces:**
- Consumes: `lessonConcept`, `adjacentLessons`, `CheckResponse` (Task 2); `startLesson`, `answerKnowledgeCheck` (Task 4); `useTermSheet` (Slice 2).
- Produces: `LessonView({ conceptId, initialResponses, initialCompleted })`. Task 10's e2e relies on: numbered section headings (`1. What is …?`), a "Sample data" badge, `role="group"` per check named "Knowledge check N of M", "Correct answer" marker text, a `role="status"` completion block containing "Lesson complete" and a "Back to Academy" link.

- [ ] **Step 1: LessonSections (pure presentational)**

```tsx
// src/components/academy/LessonSections.tsx
import type { ReactNode } from "react";
import type { FinancialConcept } from "@/lib/concepts";

/** The 10-part lesson template, numbered. personalApplication is Slice 4. */
export function LessonSections({ concept }: { concept: FinancialConcept }) {
  const lesson = concept.lesson!;
  const sections: { title: string; body: ReactNode }[] = [
    { title: `What is ${concept.title.toLowerCase()}?`, body: <p>{lesson.intro}</p> },
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
              <p className="rounded-lg bg-inset p-2 font-mono text-sm text-primary">
                {lesson.calculation.formula}
              </p>
              <p className="mt-2">{lesson.calculation.walkthrough}</p>
            </>
          ),
        }]
      : []),
    {
      title: "A sample household",
      body: (
        <>
          <span className="mb-1 inline-block rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-tertiary">
            Sample data
          </span>
          <p>{lesson.genericExample}</p>
        </>
      ),
    },
    { title: "Common misunderstanding", body: <p>{lesson.commonMisunderstanding}</p> },
    { title: "Where you'll see this in PFI", body: <p>{lesson.reinforcementPreview}</p> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {sections.map((s, i) => (
        <section key={s.title}>
          <h2 className="mb-1 text-sm font-semibold text-primary">
            {i + 1}. {s.title}
          </h2>
          <div className="text-sm leading-relaxed text-secondary">{s.body}</div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: KnowledgeChecks (client; records answers, shows explanations, completion state)**

```tsx
// src/components/academy/KnowledgeChecks.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, CheckCircle2 } from "lucide-react";
import { answerKnowledgeCheck } from "@/app/actions/academy";
import type { KnowledgeCheck } from "@/lib/concepts";
import type { CheckResponse } from "@/lib/concepts/progress";

export function KnowledgeChecks({
  conceptId, checks, initialResponses, initialCompleted,
}: {
  conceptId: string;
  checks: KnowledgeCheck[];
  initialResponses: CheckResponse[];
  initialCompleted: boolean;
}) {
  const [responses, setResponses] = useState<CheckResponse[]>(initialResponses);
  const [completed, setCompleted] = useState(initialCompleted);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const answerFor = (checkIndex: number) => responses.find((r) => r.checkIndex === checkIndex);

  function choose(checkIndex: number, choiceIndex: number) {
    if (answerFor(checkIndex) || pending) return;
    setError("");
    startTransition(async () => {
      const result = await answerKnowledgeCheck(conceptId, checkIndex, choiceIndex);
      if (result.error) {
        setError(result.error);
        return;
      }
      setResponses(result.responses ?? []);
      setCompleted(!!result.completed);
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-primary">Check your understanding</h2>

      {checks.map((check, i) => {
        const answered = answerFor(i);
        return (
          <div
            key={i}
            role="group"
            aria-label={`Knowledge check ${i + 1} of ${checks.length}`}
            className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-inset p-3"
          >
            <p className="text-sm text-primary">{check.prompt}</p>
            {check.choices.map((choice, c) => {
              const isCorrect = c === check.correctIndex;
              const isChosen = answered?.choiceIndex === c;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={!!answered || pending}
                  onClick={() => choose(i, c)}
                  className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors ${
                    isChosen ? "border-border-strong text-primary" : "border-border-subtle text-secondary"
                  } ${answered ? "" : "hover:border-border-strong hover:text-primary"}`}
                >
                  <span>{choice}</span>
                  {answered && isCorrect && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-positive">
                      <Check size={12} aria-hidden /> Correct answer
                    </span>
                  )}
                  {answered && isChosen && !isCorrect && (
                    <span className="shrink-0 text-[11px] text-tertiary">Your answer</span>
                  )}
                </button>
              );
            })}
            <div aria-live="polite">
              {answered && <p className="text-xs leading-relaxed text-secondary">{check.explanation}</p>}
            </div>
          </div>
        );
      })}

      {error && (
        <p role="alert" className="text-xs text-negative">
          {error} — your answer wasn&apos;t saved. Tap a choice to try again.
        </p>
      )}

      {completed && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-inset p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <CheckCircle2 size={16} aria-hidden className="text-positive" />
            Lesson complete
          </p>
          <p className="text-xs text-secondary">
            This term&apos;s definition sheet now includes its full analytical depth.
          </p>
          <Link
            href="/academy"
            className="self-start rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-border-strong"
          >
            Back to Academy
          </Link>
        </div>
      )}
    </section>
  );
}
```

Note the error path: the choice button is only disabled by a *recorded* answer, so a failed
save leaves the check answerable — no dead end.

- [ ] **Step 3: LessonView (client; tabs, startLesson ping, pager, Related tab)**

```tsx
// src/components/academy/LessonView.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { startLesson } from "@/app/actions/academy";
import { useTermSheet } from "@/components/concepts/TermSheetProvider";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import { adjacentLessons, lessonConcept, type CheckResponse } from "@/lib/concepts/progress";
import { KnowledgeChecks } from "./KnowledgeChecks";
import { LessonSections } from "./LessonSections";

const TABS = [
  { key: "lesson", label: "Lesson" },
  { key: "related", label: "Related" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function LessonView({
  conceptId, initialResponses, initialCompleted,
}: {
  conceptId: string;
  initialResponses: CheckResponse[];
  initialCompleted: boolean;
}) {
  // The page validated the id; non-null here.
  const concept = lessonConcept(CONCEPT_REGISTRY, conceptId)!;
  const [tab, setTab] = useState<TabKey>("lesson");
  const { openTerm } = useTermSheet();
  const { prev, next } = adjacentLessons(CONCEPT_REGISTRY, conceptId);
  const prevConcept = prev ? CONCEPT_REGISTRY.byId(prev) : null;
  const nextConcept = next ? CONCEPT_REGISTRY.byId(next) : null;

  useEffect(() => {
    // Idempotent upsert; a failure only delays "In progress" until an answer lands.
    void startLesson(conceptId);
  }, [conceptId]);

  function onTablistKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const i = TABS.findIndex((t) => t.key === tab);
    const nextIndex = event.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
    setTab(TABS[nextIndex]!.key);
    document.getElementById(`tab-${TABS[nextIndex]!.key}`)?.focus();
  }

  const related = concept.relatedConceptIds
    .map((id) => CONCEPT_REGISTRY.byId(id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.status === "published");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold text-primary">{concept.title}</h1>
        <p className="mt-1 text-sm text-secondary">{concept.shortDefinition}</p>
      </header>

      <div role="tablist" aria-label="Lesson sections" onKeyDown={onTablistKeyDown}
        className="flex rounded-full border border-border-subtle bg-inset p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            className={`min-h-8 flex-1 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === t.key ? "bg-elevated-2 text-primary shadow-card" : "text-secondary hover:text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="panel-lesson" role="tabpanel" aria-labelledby="tab-lesson" hidden={tab !== "lesson"}
        className="flex flex-col gap-6">
        <LessonSections concept={concept} />
        <KnowledgeChecks
          conceptId={conceptId}
          checks={concept.lesson!.knowledgeCheck}
          initialResponses={initialResponses}
          initialCompleted={initialCompleted}
        />
      </div>

      <div id="panel-related" role="tabpanel" aria-labelledby="tab-related" hidden={tab !== "related"}
        className="flex flex-col gap-4">
        {concept.businessContext && (
          <section>
            <h2 className="mb-1 text-sm font-semibold text-primary">In business terms</h2>
            <p className="text-sm leading-relaxed text-secondary">{concept.businessContext}</p>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-primary">Related concepts</h2>
          {related.map((r) =>
            r.lesson ? (
              <Link key={r.id} href={`/academy/${r.id}`}
                className="flex flex-col rounded-xl border border-border-subtle bg-inset p-3 transition-colors hover:border-border-strong">
                <span className="text-sm font-medium text-primary">{r.title}</span>
                <span className="text-xs text-secondary">{r.shortDefinition}</span>
              </Link>
            ) : (
              <button key={r.id} type="button" onClick={() => openTerm(r.id)}
                className="flex flex-col rounded-xl border border-border-subtle bg-inset p-3 text-left transition-colors hover:border-border-strong">
                <span className="text-sm font-medium text-primary">{r.title}</span>
                <span className="text-xs text-secondary">{r.shortDefinition}</span>
              </button>
            ),
          )}
        </section>
      </div>

      <nav aria-label="Lesson pager" className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
        {prevConcept ? (
          <Link href={`/academy/${prevConcept.id}`} className="flex items-center gap-1 text-xs text-secondary hover:text-primary">
            <ChevronLeft size={14} aria-hidden /> {prevConcept.title}
          </Link>
        ) : <span />}
        {nextConcept ? (
          <Link href={`/academy/${nextConcept.id}`} className="flex items-center gap-1 text-xs text-secondary hover:text-primary">
            {nextConcept.title} <ChevronRight size={14} aria-hidden />
          </Link>
        ) : <span />}
      </nav>
    </div>
  );
}
```

- [ ] **Step 4: Page + loading**

```tsx
// src/app/academy/[conceptId]/page.tsx
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import { lessonConcept } from "@/lib/concepts/progress";
import { getAcademyProgress, getProfile } from "@/lib/data/queries";
import { LessonView } from "@/components/academy/LessonView";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ conceptId: string }>;
}) {
  const { conceptId } = await params;
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");

  // Unknown, unpublished, or glossary-only → 404 (comprehension still lives in the term sheet).
  if (!lessonConcept(CONCEPT_REGISTRY, conceptId)) notFound();

  const { rows } = await getAcademyProgress(supabase);
  const row = rows.find((r) => r.conceptId === conceptId);

  return (
    <LessonView
      conceptId={conceptId}
      initialResponses={row?.checkResponses ?? []}
      initialCompleted={!!row?.completedAt}
    />
  );
}
```

```tsx
// src/app/academy/[conceptId]/loading.tsx
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-label="Loading lesson" role="status">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 rounded bg-elevated" />
        <div className="h-4 w-72 rounded bg-elevated" />
      </div>
      <div className="h-9 rounded-full bg-elevated" />
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-elevated" />)}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. Then in `pnpm dev`: open `/academy/revenue` — numbered sections, Sample data badge, two checks; answer both → "Lesson complete" appears and `/academy` shows Revenue as Completed, "1 of 10 lessons". `/academy/short-term-obligations` and `/academy/nope` → 404.

- [ ] **Step 6: Commit**

```bash
git add src/components/academy src/app/academy
git commit -m "feat(academy): lesson experience — sections, knowledge checks, tabs, pager"
```

---

### Task 8: Term-sheet wiring — layout completed-ids, provider, sheet CTA + variants

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/components/concepts/TermSheetProvider.tsx`
- Modify: `src/components/concepts/TermDefinitionSheet.tsx`

**Interfaces:**
- Consumes: `getCompletedConceptIds` (Task 4), `buildTermSheetModel(..., { completed })` (Task 3).
- Produces: `TermSheetProvider({ children, completedConceptIds?: string[] })`. The sheet shows "Take the lesson" (pre-completion) / "Lesson completed" + depth + "Review lesson" (completed) for lesson-bearing concepts; glossary-only sheets are unchanged.

- [ ] **Step 1: Layout fetches completed ids**

In `src/app/layout.tsx`, make `RootLayout` async and fetch (signed-out users get `[]` via RLS; note this makes the root layout dynamic — the app is already cookie-gated everywhere, so no route loses static rendering it actually had):

```tsx
import { createClient } from "@/lib/supabase/server";
import { getCompletedConceptIds } from "@/lib/data/queries";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const completedConceptIds = await getCompletedConceptIds(supabase);

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TermSheetProvider completedConceptIds={completedConceptIds}>
          <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-28">{children}</main>
          <BottomNav />
        </TermSheetProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Provider threads the completed set into the model**

In `TermSheetProvider.tsx`:

```tsx
export function TermSheetProvider({
  children,
  completedConceptIds = [],
}: {
  children: ReactNode;
  completedConceptIds?: string[];
}) {
  // ...existing stack state and api unchanged...
  const completedSet = useMemo(() => new Set(completedConceptIds), [completedConceptIds]);

  const currentId = stack.at(-1) ?? null;
  const model = currentId
    ? buildTermSheetModel(CONCEPT_REGISTRY, currentId, { completed: completedSet.has(currentId) })
    : null;
  // ...render unchanged...
}
```

- [ ] **Step 3: Sheet — completed marker, depth sections, lesson CTA**

In `TermDefinitionSheet.tsx`, add imports (`Link` from `next/link`, `CheckCircle2` from lucide) and three blocks:

Directly after the `shortDefinition` paragraph, the completed marker:

```tsx
{model.completed && (
  <p className="flex items-center gap-1.5 text-xs text-secondary">
    <CheckCircle2 size={14} aria-hidden className="text-positive" />
    Lesson completed
  </p>
)}
```

After the formula/household block, the unlocked depth (renders only when the builder populated the fields, i.e. completed):

```tsx
{model.whyItMatters && (
  <div>
    <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Why it matters</p>
    <p className="text-sm leading-relaxed text-secondary">{model.whyItMatters}</p>
  </div>
)}
{model.businessContext && (
  <div>
    <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">In business terms</p>
    <p className="text-sm leading-relaxed text-secondary">{model.businessContext}</p>
  </div>
)}
```

After the Related block, the CTA (last element in the sheet):

```tsx
{model.hasLesson && (
  <Link
    href={`/academy/${model.id}`}
    onClick={onClose}
    className="mt-1 self-start rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-border-strong"
  >
    {model.completed ? "Review lesson" : "Take the lesson"}
  </Link>
)}
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean (Slice 2's e2e sheet assertions are re-run in Task 10). In `pnpm dev`: a lesson-bearing term (e.g. Revenue on `/report` with demo data) shows "Take the lesson"; after completing the Revenue lesson it shows "Lesson completed", Why it matters, In business terms, and "Review lesson". A glossary term (e.g. Available capital on Home) shows neither CTA nor marker.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/components/concepts/TermSheetProvider.tsx src/components/concepts/TermDefinitionSheet.tsx
git commit -m "feat(academy): term-sheet lesson CTA and completed variant wired through layout"
```

---

### Task 9: MetricCard nesting fix + KNOWN_LIMITATIONS removal

**Files:**
- Modify: `src/components/dashboard/MetricCard.tsx`
- Modify: `docs/KNOWN_LIMITATIONS.md` (remove the MetricCard nested-interactive entry, ~line 117)

**Interfaces:**
- Produces: `MetricCard` with both `href` and `conceptId` renders the term button and a sibling "View details" link — never `<button>` inside `<a>`. `href`-only cards keep the whole-card link. Task 10's e2e asserts `main a button, main button a` count is 0.

- [ ] **Step 1: Restructure the render**

Replace the tail of `MetricCard` (from `const card = (` down) with:

```tsx
  const inner = (
    <>
      <p className="text-[11px] leading-tight font-medium text-secondary sm:text-xs">
        {conceptId ? <FinancialTerm conceptId={conceptId}>{label}</FinancialTerm> : label}
      </p>
      <p className={`tabular mt-1 text-base font-semibold sm:text-xl ${toneText[tone]}`}>{value}</p>
      {trend && trend.length > 1 && (
        <>
          <Sparkline values={trend} tone={tone} />
          {trendDescription && <span className="sr-only">{trendDescription}</span>}
        </>
      )}
      {footer}
    </>
  );

  const cardClass = "flex min-h-24 flex-col justify-between p-2.5 sm:min-h-28 sm:p-4";

  // A card carrying a tappable term must not live inside a link (<a> may not
  // contain interactive content): the drill-down becomes an explicit sibling
  // link instead of a whole-card wrap. KNOWN_LIMITATIONS 2026-07-20, resolved
  // by Academy Slice 3.
  if (href && conceptId) {
    return (
      <Card className={cardClass}>
        {inner}
        <Link
          href={href}
          aria-label={`${label}: ${value}. View details`}
          className="mt-1 self-start text-[11px] text-secondary underline-offset-2 hover:text-primary hover:underline sm:text-xs"
        >
          View details
        </Link>
      </Card>
    );
  }

  const card = (
    <Card className={`${cardClass} ${href ? "transition-colors hover:border-border-strong" : ""}`}>
      {inner}
    </Card>
  );
  if (!href) return card;
  return (
    <Link href={href} aria-label={`${label}: ${value}. View details`} className="block rounded-card">
      {card}
    </Link>
  );
```

- [ ] **Step 2: Remove the KNOWN_LIMITATIONS entry**

Delete the bullet beginning `**\`MetricCard\` produces invalid nested interactive content when both \`href\` and \`conceptId\` are set**` from `docs/KNOWN_LIMITATIONS.md`.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. In `pnpm dev` with demo data at 390px: "Available capital" and "Obligations" cards show the dotted-underline term, the value, and a "View details" link; tapping the term opens the sheet, tapping "View details" navigates. Inspect DOM: no `<button>` inside `<a>`.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/MetricCard.tsx docs/KNOWN_LIMITATIONS.md
git commit -m "fix(dashboard): MetricCard term + drill-down as sibling controls, closing the nested-interactive debt"
```

---

### Task 10: e2e journey, docs, full check, live verification

**Files:**
- Create: `e2e/academy.spec.ts`
- Modify: `docs/DECISIONS.md` (append entry #34)
- Modify: `docs/CURRENT_PHASE.md` (header + Completed section)

**Interfaces:**
- Consumes: everything above; `createPasswordUser`/`deletePasswordUser` fixture; the EmptyDashboard "Load …" demo buttons.

- [ ] **Step 1: Write the e2e journey**

```ts
// e2e/academy.spec.ts
import { expect, test, type Page } from "@playwright/test";
import { createPasswordUser, deletePasswordUser, type PasswordUser } from "./fixtures/password-user";

// One user completes the full loop; steps build on each other.
test.describe.configure({ mode: "serial" });

let page: Page;
let user: PasswordUser;

test.beforeAll(async ({ browser }) => {
  user = await createPasswordUser({ consent: true });
  page = await browser.newPage();
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
});

test.afterAll(async () => {
  await page.close();
  await deletePasswordUser(user.userId);
});

test("academy tab routes to the zero-progress home with no locks", async () => {
  await page.getByRole("link", { name: "Academy" }).click();
  await page.waitForURL("**/academy");
  await expect(page.getByRole("heading", { name: "Academy" })).toBeVisible();
  await expect(page.getByText("0 of 10 lessons")).toBeVisible();
  await expect(page.getByText("Not started").first()).toBeVisible();
  await expect(page.getByText(/locked/i)).toHaveCount(0); // comprehension is never locked
});

test("glossary-only row opens the definition sheet, not a lesson", async () => {
  await page.getByRole("button", { name: /Short-term obligations/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /lesson/i })).toHaveCount(0); // no CTA on glossary terms
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("demo data loads so term surfaces render", async () => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Load / }).first().click();
  await expect(page.getByText("Personal Index")).toBeVisible({ timeout: 30_000 });
});

test("the report's Revenue term offers Take the lesson and deep-links into it", async () => {
  await page.goto("/report");
  await page.getByRole("button", { name: "Revenue — show definition" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "Take the lesson" })).toBeVisible();
  await dialog.getByRole("link", { name: "Take the lesson" }).click();
  await page.waitForURL("**/academy/revenue");
  await expect(page.getByRole("heading", { name: "1. What is revenue?" })).toBeVisible();
  await expect(page.getByText("Sample data")).toBeVisible(); // generic example is labeled
});

test("answering all checks completes the lesson — right or wrong", async () => {
  const groups = page.getByRole("group", { name: /Knowledge check/ });
  const count = await groups.count();
  expect(count).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < count; i++) {
    const group = groups.nth(i);
    await group.getByRole("button").first().click(); // first choice, correctness never gates
    await expect(group.getByText("Correct answer")).toBeVisible(); // marker + explanation appear
  }
  const complete = page.getByRole("status").filter({ hasText: "Lesson complete" });
  await expect(complete).toBeVisible();
});

test("home reflects the completion", async () => {
  await page.getByRole("link", { name: "Back to Academy" }).click();
  await page.waitForURL("**/academy");
  await expect(page.getByText("1 of 10 lessons")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recently completed" })).toBeVisible();
  await expect(page.getByText("Completed").first()).toBeVisible();
});

test("the term sheet unlocks the completed variant", async () => {
  await page.goto("/report");
  await page.getByRole("button", { name: "Revenue — show definition" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Lesson completed")).toBeVisible();
  await expect(dialog.getByText("Why it matters")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Review lesson" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("no nested interactive content on the dashboard", async () => {
  await page.goto("/");
  await expect(page.getByText("Personal Index")).toBeVisible();
  expect(await page.locator("main a button, main button a").count()).toBe(0);
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: `academy.spec.ts` fully green; `smoke.spec.ts`, `password-auth.spec.ts`, `manifest.spec.ts` unaffected. (Reminder: `smoke.spec.ts` cannot be filtered with `-g` — serial, session-state dependent.)

- [ ] **Step 3: DECISIONS.md entry #34**

Append:

```markdown
## 34. 2026-07-21 — Academy Slice 3: derived progress, ungated completion, no streak/locks

**Decision:** Academy progress lives in one `academy_progress` table (owner-only RLS); status is always derived (no row / `completed_at` null / set), never stored. Completion = reaching the end of a lesson having answered all its knowledge checks — correctness never gates (checks teach; explanations show either way). Answer correctness is never persisted — derivable from the compile-time registry. The mockups' streak counter is omitted entirely and "Locked" states are replaced by Not started / In progress / Completed with prerequisites as non-blocking "Builds on" hints. Academy is the 5th bottom-nav tab. The lesson page ships a Lesson · Related tab shell; Slice 4 adds "Your Data" (`personalApplication`).

**Alternatives:** streak softened to "last activity" (still pressure-adjacent, omitted); correctness-gated completion (pass/fail feel violates the no-shame rule); stepper/pager lesson (section state the MVP doesn't need); sheet-based lessons (no deep links, poor long-form mobile UX); storing derived status (drift risk with the registry).

**Consequences:** the term sheet's completed variant is driven by a layout-level completed-ids fetch (root layout is now async/dynamic — the app was already cookie-gated everywhere); `answerKnowledgeCheck` revalidates the layout on completion. `MetricCard` drill-down became an explicit sibling "View details" link when a term is present, closing the KNOWN_LIMITATIONS nested-interactive entry.
```

- [ ] **Step 4: Update CURRENT_PHASE.md**

Update the header line (last-updated + "Next up: Academy Slice 4 — personalization rendering + analytics events"), extend the **Phase:** chain with Slice 3, and replace the "Completed (this phase)" section with a task-by-task summary of this slice (mirror the Slice 2 section's structure: one bullet per task with commit hashes).

- [ ] **Step 5: Full check + live verification**

Run: `pnpm check`
Expected: lint, typecheck, unit tests, build all green.

Then live-verify in `pnpm dev` at ~390px **and** desktop:
1. Five nav tabs fit at 390px without wrapping; Academy tab highlights on `/academy` and `/academy/revenue`.
2. `/academy`: progress card, continue card, three modules, glossary rows open sheets, keyboard: tab through rows, Enter activates.
3. Lesson: tabs switch by click and Arrow keys; checks answer by keyboard; explanation is announced (VoiceOver spot-check if available); completion block appears.
4. Term sheet pre/post completion variants on `/report`; "Available capital" card on Home: term button + View details link both work.
5. Loading skeletons visible on hard reload (throttle if needed).

- [ ] **Step 6: Commit**

```bash
git add e2e/academy.spec.ts docs/DECISIONS.md docs/CURRENT_PHASE.md
git commit -m "test(academy): e2e learning-loop journey; docs: DECISIONS #34, phase update"
```

---

## Plan Self-Review (completed)

- **Spec coverage:** routes/nav (T5, T6, T7) ✓ · progress schema + RLS (T1) ✓ · derivations (T2) ✓ · server actions (T4) ✓ · home UI incl. degraded state (T6) ✓ · lesson + checks + tabs + pager (T7) ✓ · term-sheet variants + CTA + layout fetch (T3, T8) ✓ · MetricCard fix + KNOWN_LIMITATIONS (T9) ✓ · e2e/docs/live verification (T10) ✓ · no-streak/no-locks enforced by absence + e2e lock-text assertion ✓
- **Placeholders:** none — every code step carries the full code.
- **Type consistency:** `ProgressRow`/`CheckResponse` (T2) are the exact types used in T4 queries/actions and T6–T8 props; `buildTermSheetModel` third param `{ completed?: boolean }` matches T8's call; e2e selectors match the exact strings rendered in T6–T9.
