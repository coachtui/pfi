# Index-Point Change Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the dashboard's "Today" stat from percent-of-index-level to index-point change with the percent in parentheses (`+1.3 (+1.2%) Today`), moving the calculation out of the React component into the financial engine.

**Architecture:** A new pure helper `indexDayChange` in `src/lib/financial-engine/indexing.ts` computes `{ points, pct }`; a new `formatSignedPoints` formatter in `format.ts` renders points; `HomeDashboard.tsx` becomes format-and-render only. Spec: `docs/superpowers/specs/2026-07-20-index-point-change-design.md`.

**Tech Stack:** TypeScript (strict), Vitest, Next.js 16 App Router client component. No new dependencies.

## Global Constraints

- `src/lib/financial-engine/` stays framework-free: no React/Next imports.
- Signed formatters use the true minus-sign character `−` (U+2212), never ASCII hyphen — matches `formatSignedPercent`.
- One decimal place for both points and percent (matches the index level's `.toFixed(1)`).
- Never communicate positive/negative through color alone — the sign character must remain in the rendered text.
- Imports in components come from the barrel `@/lib/financial-engine` (its `index.ts` already re-exports `./indexing` and `./format` via `export *` — no barrel edits needed).
- `pnpm check` (lint + typecheck + test + build) must be green before the work is declared complete.

---

### Task 1: `indexDayChange` engine helper

**Files:**
- Modify: `src/lib/financial-engine/indexing.ts` (append at end of file)
- Test: `src/lib/financial-engine/indexing.test.ts` (append at end of file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `indexDayChange(latest: number, previous: number | undefined): { points: number | null; pct: number | null }` — Task 3 imports this from `@/lib/financial-engine`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/financial-engine/indexing.test.ts` (the file already imports from `./indexing`; add `indexDayChange` to that import list):

```ts
describe("indexDayChange", () => {
  it("returns point delta and percent for a normal day-over-day move", () => {
    const change = indexDayChange(104.2, 102.9);
    expect(change.points).toBeCloseTo(1.3, 10);
    expect(change.pct).toBeCloseTo((1.3 / 102.9) * 100, 10);
  });

  it("uses the absolute previous value as the percent denominator", () => {
    const change = indexDayChange(-90, -100);
    expect(change.points).toBeCloseTo(10, 10);
    expect(change.pct).toBeCloseTo(10, 10);
  });

  it("returns null pct (but real points) when previous is exactly 0", () => {
    const change = indexDayChange(4.2, 0);
    expect(change.points).toBeCloseTo(4.2, 10);
    expect(change.pct).toBeNull();
  });

  it("returns all-null when there is no previous point", () => {
    expect(indexDayChange(104.2, undefined)).toEqual({ points: null, pct: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/indexing.test.ts`
Expected: FAIL — `indexDayChange` is not exported (`has no exported member` type error or runtime "not a function").

- [ ] **Step 3: Write the implementation**

Append to `src/lib/financial-engine/indexing.ts`:

```ts
/**
 * Day-over-day index change. `points` is the raw index-point delta; `pct` is
 * the percent change of the index level, kept as secondary context only
 * (see DECISIONS #30 — points are the primary display unit).
 * `points` is null when there is no previous point; `pct` is additionally
 * null when `previous` is 0 (no divide-by-zero, no fake 0.0%).
 */
export function indexDayChange(
  latest: number,
  previous: number | undefined,
): { points: number | null; pct: number | null } {
  if (previous === undefined) return { points: null, pct: null };
  const points = latest - previous;
  const pct = previous === 0 ? null : (points / Math.abs(previous)) * 100;
  return { points, pct };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/indexing.test.ts`
Expected: PASS (all pre-existing tests in the file still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/indexing.ts src/lib/financial-engine/indexing.test.ts
git commit -m "feat(engine): indexDayChange day-over-day point/percent helper"
```

---

### Task 2: `formatSignedPoints` formatter

**Files:**
- Modify: `src/lib/financial-engine/format.ts` (insert after `formatSignedPercent`)
- Test: Create `src/lib/financial-engine/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatSignedPoints(n: number): string` — Task 3 imports this from `@/lib/financial-engine`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/financial-engine/format.test.ts` (no format tests exist today — this is a new file):

```ts
import { describe, expect, it } from "vitest";
import { formatSignedPoints } from "./format";

describe("formatSignedPoints", () => {
  it("formats a positive delta with a plus sign and one decimal", () => {
    expect(formatSignedPoints(1.3)).toBe("+1.3");
  });

  it("formats a negative delta with a true minus sign (U+2212)", () => {
    expect(formatSignedPoints(-0.4)).toBe("−0.4");
  });

  it("formats zero as +0.0", () => {
    expect(formatSignedPoints(0)).toBe("+0.0");
  });

  it("rounds to one decimal", () => {
    expect(formatSignedPoints(2.649)).toBe("+2.6");
    expect(formatSignedPoints(-2.66)).toBe("−2.7");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/financial-engine/format.test.ts`
Expected: FAIL — `formatSignedPoints` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/financial-engine/format.ts`, insert directly after the `formatSignedPercent` function:

```ts
/** Signed index points with one decimal, e.g. "+1.3" / "−0.4". */
export function formatSignedPoints(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${Math.abs(n).toFixed(1)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/financial-engine/format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/format.ts src/lib/financial-engine/format.test.ts
git commit -m "feat(engine): formatSignedPoints signed one-decimal point formatter"
```

---

### Task 3: HomeDashboard display switch

**Files:**
- Modify: `src/components/dashboard/HomeDashboard.tsx` (import block ~lines 18–30; computation ~lines 93–99; render ~lines 126–134)

**Interfaces:**
- Consumes: `indexDayChange(latest, previous)` → `{ points: number | null; pct: number | null }` (Task 1); `formatSignedPoints(n)` → `"+1.3"` (Task 2); existing `formatSignedPercent(n)` → `"+1.2%"`.
- Produces: nothing downstream.

- [ ] **Step 1: Update the import block**

In the `@/lib/financial-engine` import list, add `indexDayChange` and `formatSignedPoints` (keep the list alphabetized as it is today):

```ts
import {
  availablePosition,
  buildIndexSeries,
  computeDrivers,
  computeMomentum,
  cushion,
  formatDollars,
  formatSignedPercent,
  formatSignedPoints,
  indexDayChange,
  waterline,
  type DailySnapshot,
  type FinancialEvent,
  type Momentum,
} from "@/lib/financial-engine";
```

- [ ] **Step 2: Replace the in-component calculation**

Replace this block:

```ts
  const latest = snapshots[snapshots.length - 1];
  const latestPoint = points[points.length - 1];
  const prevPoint = points[points.length - 2];
  const todayChangePct =
    prevPoint && prevPoint.actual !== 0
      ? ((latestPoint.actual - prevPoint.actual) / Math.abs(prevPoint.actual)) * 100
      : 0;
```

with:

```ts
  const latest = snapshots[snapshots.length - 1];
  const latestPoint = points[points.length - 1];
  const prevPoint = points[points.length - 2];
  const todayChange = indexDayChange(latestPoint.actual, prevPoint?.actual);
  const todayPoints = todayChange.points ?? 0;
```

- [ ] **Step 3: Replace the render**

Replace this block:

```tsx
            <p className="mt-1 text-sm">
              <span
                className={`tabular font-medium ${todayChangePct >= 0 ? "text-positive" : "text-negative"}`}
              >
                {formatSignedPercent(todayChangePct)}
              </span>{" "}
              <span className="text-tertiary">Today</span>
            </p>
```

with:

```tsx
            <p className="mt-1 text-sm">
              <span
                className={`tabular font-medium ${todayPoints >= 0 ? "text-positive" : "text-negative"}`}
              >
                {formatSignedPoints(todayPoints)}
                {todayChange.pct !== null && <> ({formatSignedPercent(todayChange.pct)})</>}
              </span>{" "}
              <span className="text-tertiary">Today</span>
            </p>
```

Notes: when `pct` is null the parenthetical disappears entirely (per spec — no fake `0.0%`); when `points` is null (single data point) the display falls back to `+0.0 Today`, preserving today's behavior. `formatSignedPercent` remains imported — it is still used here and the same import feeds nothing else in this file, so do NOT remove it.

- [ ] **Step 4: Run the full check**

Run: `pnpm check`
Expected: lint, typecheck, all tests, and build green. (`formatSignedPercent`'s other consumer, `src/app/data/page.tsx`, is untouched.)

- [ ] **Step 5: Visual verification**

Run: `pnpm dev`, sign in with the demo account, and view the dashboard at ~390px width and a desktop width. Confirm the stat reads like `+1.3 (+1.2%) Today` (sign + color both present, tabular alignment intact, line doesn't wrap awkwardly at 390px). If you cannot authenticate, pause and ask the user to verify instead — do not skip silently.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/HomeDashboard.tsx
git commit -m "feat(dashboard): show Today change as index points with percent in parens"
```

---

### Task 4: Documentation updates

**Files:**
- Modify: `docs/KNOWN_LIMITATIONS.md` (remove the `% Today` bullet, currently line 104)
- Modify: `docs/DECISIONS.md` (append entry #30; #29 is currently the last)
- Modify: `docs/CURRENT_PHASE.md` ("Next three priorities" item 3 and "Decisions needed" first bullet)

**Interfaces:** none — docs only.

- [ ] **Step 1: Remove the KNOWN_LIMITATIONS entry**

Delete this bullet from `docs/KNOWN_LIMITATIONS.md`:

```markdown
- **`% Today`** is the day-over-day change of the index level, which reads large when the index level is far from its scale; consider switching to index-point change display.
```

- [ ] **Step 2: Append DECISIONS.md entry #30**

Append after entry #29, matching the existing entry format:

```markdown
## 30. 2026-07-20 — "Today" stat displays index-point change, percent demoted to parenthetical

**Decision:** The dashboard's day-over-day stat under the Personal Index level shows the index-point delta as the primary number, with the percent change in parentheses (`+1.3 (+1.2%) Today`). The calculation moved out of `HomeDashboard.tsx` into `indexDayChange` in `src/lib/financial-engine/indexing.ts` (the component had been computing the percent inline, violating the no-formulas-in-components rule).

**Alternatives considered:** points-only with a "pts" suffix (cleanest, but drops the percent reading entirely); bare points (ambiguous next to the index level); percent-only status quo (rejected — percent-of-index-level magnitude is an artifact of where the index sits relative to its scale, not of how much changed).

**Reasoning:** Points are how market indexes report daily moves, matching the product metaphor, and their magnitude is scale-independent. Keeping the percent as secondary context preserves the familiar reading without letting the distortion lead. Owner chose points+percent over points-only.

**Consequences:** `pct` is null (parenthetical omitted) when the previous index value is 0 or missing — no fake `0.0%`. The Data page's cohort trend percentages and ScoreView's integer score-point deltas are unrelated units and unchanged. KNOWN_LIMITATIONS' `% Today` entry is resolved.
```

- [ ] **Step 3: Update CURRENT_PHASE.md**

In "Next three priorities", replace item 3:

```markdown
3. **Decide on `% Today` (index-point change)** — see KNOWN_LIMITATIONS and "Decisions needed" below.
```

with:

```markdown
3. ~~Decide on `% Today` (index-point change)~~ — **resolved 2026-07-20** (DECISIONS #30): the Today stat now shows index-point change with percent in parens; calculation moved into the engine (`indexDayChange`).
```

In "Decisions needed", delete the bullet:

```markdown
- Whether `% Today` should become index-point change (see KNOWN_LIMITATIONS).
```

- [ ] **Step 4: Commit**

```bash
git add docs/KNOWN_LIMITATIONS.md docs/DECISIONS.md docs/CURRENT_PHASE.md
git commit -m "docs: record index-point-change decision (DECISIONS #30), resolve % Today items"
```
