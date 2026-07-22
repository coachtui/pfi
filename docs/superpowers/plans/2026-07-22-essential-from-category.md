# Essential-from-Category Score Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock the suppressed PFI score by deriving each transaction's `essential` flag deterministically from its `category`, so the score becomes reachable once transactions are categorized.

**Architecture:** A framework-free engine helper `essentialForCategory(category)` classifies the taxonomy into essential/non-essential. `metric-inputs.ts` uses `t.essential ?? essentialForCategory(t.category)` at its single essential-accumulation site, so an explicit flag still wins but `null` (all user data) derives from the effective, override-applied category. No UI, no AI. This is slice A; AI-assisted categorization and a manual essential override are slice B.

**Tech Stack:** TypeScript (strict), Vitest, framework-free `src/lib/financial-engine/`.

## Global Constraints

- Deterministic code calculates; AI only narrates — no AI in this slice. (CLAUDE.md)
- `src/lib/financial-engine/` must stay free of React/Next imports (package-extraction rule). The new helper lives **in the engine**, not in `src/lib/config/`, so the engine gains no new cross-boundary dependency — it already branches on bare category strings (`"income"`, `"savings"`, `"debt_payment"`). This takes the spec's explicit "or a framework-free engine helper" option.
- Methodology changes never silently rewrite history: bump `PFI_SCORE_VERSION` (`score-types.ts`), currently `"1.0"` → `"1.1"`.
- Essential-by-default categories (decided 2026-07-22): `housing`, `utilities`, `insurance`, `groceries`, `health`, `debt_payment`, `transport`. Everything else (`dining`, `shopping`, `discretionary`, `savings`, `other`, `income`) and `null` → non-essential.
- `pnpm check` (lint + typecheck + test + build) must be green before completion.

---

## File Structure

- **Create** `src/lib/financial-engine/essential.ts` — the `ESSENTIAL_CATEGORIES` set + `essentialForCategory` helper. Single responsibility: category→essential classification.
- **Create** `src/lib/financial-engine/essential.test.ts` — enumerates every category + `null`.
- **Modify** `src/lib/financial-engine/metric-inputs.ts` — import the helper; change the one essential-accumulation line (currently line 182).
- **Modify** `src/lib/financial-engine/metric-inputs.test.ts` — add derivation cases.
- **Modify** `src/lib/financial-engine/score-types.ts:3` — bump `PFI_SCORE_VERSION`.
- **Modify** `src/lib/financial-engine/scoring.test.ts:56` and `score-pipeline.test.ts:53` — update version assertions; add a suppression→unlock regression test to `score-pipeline.test.ts`.
- **Modify** docs: `FINANCIAL_HEALTH_SCORE.md`, `DECISIONS.md`, `KNOWN_LIMITATIONS.md`, `CURRENT_PHASE.md`.

---

## Task 1: `essentialForCategory` helper

**Files:**
- Create: `src/lib/financial-engine/essential.ts`
- Test: `src/lib/financial-engine/essential.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `essentialForCategory(category: string | null): boolean` and `ESSENTIAL_CATEGORIES: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/financial-engine/essential.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { essentialForCategory } from "./essential";

describe("essentialForCategory", () => {
  it("classifies must-pay categories as essential", () => {
    for (const c of ["housing", "utilities", "insurance", "groceries", "health", "debt_payment", "transport"]) {
      expect(essentialForCategory(c), c).toBe(true);
    }
  });

  it("classifies discretionary, savings, income, other, and null as non-essential", () => {
    for (const c of ["dining", "shopping", "discretionary", "savings", "income", "other"]) {
      expect(essentialForCategory(c), c).toBe(false);
    }
    expect(essentialForCategory(null)).toBe(false);
  });

  it("treats unknown category strings as non-essential", () => {
    expect(essentialForCategory("not_a_real_category")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test essential.test.ts`
Expected: FAIL — cannot find module `./essential`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/financial-engine/essential.ts`:

```typescript
/**
 * Deterministic category → "essential (must-pay) spend" classification.
 * Feeds totals.essential in metric-inputs, which gates the PFI score
 * (liquid_runway_months) and drives fixed_cost_ratio. Kept in the engine
 * (not config/) so the engine stays self-contained and framework-free.
 * Category taxonomy source of truth: src/lib/config/categories.ts.
 * Normative mapping: docs/FINANCIAL_HEALTH_SCORE.md.
 */
export const ESSENTIAL_CATEGORIES: ReadonlySet<string> = new Set([
  "housing", "utilities", "insurance", "groceries", "health", "debt_payment", "transport",
]);

/**
 * Whether spending in this category is essential by default. Unknown or null
 * categories are non-essential (conservative: unflagged spend never inflates
 * essential costs). An explicit per-transaction `essential` flag overrides
 * this — see metric-inputs.
 */
export function essentialForCategory(category: string | null): boolean {
  return category !== null && ESSENTIAL_CATEGORIES.has(category);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test essential.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/financial-engine/essential.ts src/lib/financial-engine/essential.test.ts
git commit -m "feat(engine): add deterministic essentialForCategory classifier"
```

---

## Task 2: Derive essential in metric-inputs

**Files:**
- Modify: `src/lib/financial-engine/metric-inputs.ts` (import + line 182)
- Test: `src/lib/financial-engine/metric-inputs.test.ts`

**Interfaces:**
- Consumes: `essentialForCategory` from Task 1.
- Produces: `buildMetricInputs(...)` now returns `totals.essential > 0` for categorized-but-unflagged essential spend (unchanged signature).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/financial-engine/metric-inputs.test.ts` inside the `describe("buildMetricInputs", ...)` block:

```typescript
  it("derives essential from category when the flag is null", () => {
    const inputs = buildMetricInputs(
      [snap("2026-07-14", 19000), snap(AS_OF, 20000)],
      [
        // essential: null (as an imported/manual row would be), but categorized essential
        txn({ id: "r1", postedDate: "2026-07-02", amount: 1700, direction: "outflow", category: "housing" }),
        txn({ id: "g1", postedDate: "2026-07-03", amount: 500, direction: "outflow", category: "groceries" }),
        // non-essential category stays out of essential
        txn({ id: "d1", postedDate: "2026-07-04", amount: 200, direction: "outflow", category: "dining" }),
      ],
      ACCOUNTS,
      AS_OF,
    );
    expect(inputs.totals.essential).toBe(2200);
  });

  it("lets an explicit essential flag override the category default", () => {
    const inputs = buildMetricInputs(
      [snap("2026-07-14", 19000), snap(AS_OF, 20000)],
      [
        // explicitly NOT essential despite an essential-by-default category
        txn({ id: "h2", postedDate: "2026-07-02", amount: 1700, direction: "outflow", category: "housing", essential: false }),
        // explicitly essential despite a non-essential category
        txn({ id: "s2", postedDate: "2026-07-03", amount: 300, direction: "outflow", category: "shopping", essential: true }),
      ],
      ACCOUNTS,
      AS_OF,
    );
    expect(inputs.totals.essential).toBe(300);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test metric-inputs.test.ts`
Expected: FAIL — first test gets `essential: 0` (derivation not wired), so `expect(2200)` fails.

- [ ] **Step 3: Add the import**

In `src/lib/financial-engine/metric-inputs.ts`, add to the imports at the top (after the existing `import ... from "./snapshot-builder";`):

```typescript
import { essentialForCategory } from "./essential";
```

- [ ] **Step 4: Change the essential-accumulation line**

In `src/lib/financial-engine/metric-inputs.ts`, find (currently line 182):

```typescript
    if (t.essential === true) bucket.essential += t.amount;
```

Replace with:

```typescript
    if (t.essential ?? essentialForCategory(t.category)) bucket.essential += t.amount;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test metric-inputs.test.ts`
Expected: PASS (existing tests + 2 new). Existing tests still pass because their essential rows set `essential: true` explicitly, which the `??` preserves.

- [ ] **Step 6: Commit**

```bash
git add src/lib/financial-engine/metric-inputs.ts src/lib/financial-engine/metric-inputs.test.ts
git commit -m "feat(engine): derive essential spend from category when unflagged"
```

---

## Task 3: Version bump + suppression→unlock regression test

**Files:**
- Modify: `src/lib/financial-engine/score-types.ts:3`
- Modify: `src/lib/financial-engine/scoring.test.ts:56`
- Modify: `src/lib/financial-engine/score-pipeline.test.ts:53` (+ new test)

**Interfaces:**
- Consumes: `computeScore` / full pipeline (unchanged signatures); the Task 2 behavior change.
- Produces: `PFI_SCORE_VERSION === "1.1"`.

- [ ] **Step 1: Write the failing regression test**

Add to `src/lib/financial-engine/score-pipeline.test.ts` inside `describe("full score pipeline", ...)`. It builds a dataset that is suppressed under the old rule (categorized essential spend, but every `essential` flag `null`) and asserts the score now activates:

```typescript
  it("unlocks a previously-suppressed score once spend is categorized (essential derived)", () => {
    const AS_OF_U = "2026-07-15";
    const accounts: ScoreAccountInput[] = [
      { id: "chk", type: "checking", institution: "First Bank", currentBalance: 9000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
      { id: "sav", type: "savings", institution: "Ally", currentBalance: 15000, creditLimit: null, interestRate: null, includeInCalculations: true, provider: "manual" },
    ];
    const base = { accountId: "chk", category: null as string | null, essential: null as boolean | null, isTransfer: false, transferPairId: null, description: "" };
    const txns: ScoreTransactionInput[] = [];
    const snapshots: DailySnapshot[] = [];
    for (let d = 179; d >= 0; d--) {
      const date = addDays(AS_OF_U, -d);
      snapshots.push({ date, liquidAssets: 24000, revolvingBalances: 0, nearTermObligations: 2600, essentialObligations: 2000, safetyBuffer: 1000, netWorth: 24000 });
      if (d % 30 === 0) {
        txns.push({ ...base, id: `pay${d}`, postedDate: date, amount: 5500, direction: "inflow", category: "income", description: "Payroll" });
        // essential:null — the exact shape imported/manual rows have
        txns.push({ ...base, id: `rent${d}`, postedDate: date, amount: 1700, direction: "outflow", category: "housing" });
        txns.push({ ...base, id: `gro${d}`, postedDate: date, amount: 600, direction: "outflow", category: "groceries" });
      }
    }
    const inputs = buildMetricInputs(snapshots, txns, accounts, AS_OF_U);
    const results = computeMetrics(inputs);
    const confidence = computeConfidence(inputs, results);
    const b = computeScore(results, confidence.byDimension, AS_OF_U);

    expect(inputs.totals.essential).toBeGreaterThan(0);
    expect(b.state).not.toBe("suppressed");
    expect(b.overall).not.toBeNull();
  });
```

- [ ] **Step 2: Run it to confirm it passes** (Task 2 already wired derivation)

Run: `pnpm test score-pipeline.test.ts`
Expected: the new test PASSES; the existing `expect(b.version).toBe("1.0")` at line 53 now FAILS after the next step. (If the new test fails here, derivation is not accumulating — re-check Task 2.)

- [ ] **Step 3: Bump the version**

In `src/lib/financial-engine/score-types.ts`, line 3:

```typescript
export const PFI_SCORE_VERSION = "1.0";
```

Change to:

```typescript
export const PFI_SCORE_VERSION = "1.1";
```

- [ ] **Step 4: Update the two version assertions**

In `src/lib/financial-engine/score-pipeline.test.ts:53` and `src/lib/financial-engine/scoring.test.ts:56`, change each:

```typescript
    expect(b.version).toBe("1.0");
```

to:

```typescript
    expect(b.version).toBe("1.1");
```

- [ ] **Step 5: Run both suites**

Run: `pnpm test score-pipeline.test.ts scoring.test.ts`
Expected: PASS (all, including the new unlock test and updated version assertions).

- [ ] **Step 6: Commit**

```bash
git add src/lib/financial-engine/score-types.ts src/lib/financial-engine/score-pipeline.test.ts src/lib/financial-engine/scoring.test.ts
git commit -m "feat(engine): bump PFI_SCORE_VERSION to 1.1; test category-derived unlock"
```

---

## Task 4: Documentation + full check

**Files:**
- Modify: `docs/FINANCIAL_HEALTH_SCORE.md`, `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/CURRENT_PHASE.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the normative score doc**

In `docs/FINANCIAL_HEALTH_SCORE.md`, find the section defining essential expenses / the data-inclusion policy (search for "essential"). Add a subsection:

```markdown
### Essential-spend classification (v1.1)

`totals.essential` counts an outflow when its per-transaction `essential` flag is
`true`, or — when that flag is unset (`null`, i.e. all imported/manual data) —
when its **category** is essential by default:

- **Essential:** housing, utilities, insurance, groceries, health, debt_payment, transport
- **Non-essential:** dining, shopping, discretionary, savings, other, income, and any unknown/uncategorized outflow

An explicit `essential` flag always overrides the category default. Source of the
map: `src/lib/financial-engine/essential.ts`. This makes the score reachable once
transactions are categorized, without a separate manual essential flag (which has
no input path in v1.1 — deferred to slice B).
```

- [ ] **Step 2: Add a DECISIONS.md entry**

Append to `docs/DECISIONS.md` (match the existing numbered format; use the next number and today's date 2026-07-22):

```markdown
## N. Essential spend derived from category (2026-07-22)

**Decision:** Derive a transaction's `essential` status from its `category` when the
raw `essential` flag is unset, via `essentialForCategory` in the engine. Bump
`PFI_SCORE_VERSION` 1.0 → 1.1.

**Context:** The PFI score hard-suppresses unless `liquid_runway_months` is available,
which requires `totals.essential > 0`. The `essential` flag was writable only by demo
seed data — no override or editor path — so real users (even with several accounts)
could never unlock the score.

**Alternatives rejected:** (a) A manual per-transaction essential toggle as the only
path — too much user effort and it left the score unreachable by default; (b) an
AI-set essential flag — puts AI directly on a score input, violating "deterministic
code calculates; AI only narrates."

**Consequences:** Score unlocks once spend is categorized (existing editor supports
this). CSV import still defaults outflows to `other` (non-essential), so a fresh import
needs its essentials categorized first — reducing that manual effort is slice B
(AI-assisted categorization + human verify + manual essential override).
```

- [ ] **Step 3: Update KNOWN_LIMITATIONS.md**

In `docs/KNOWN_LIMITATIONS.md`, find the entry referencing the `essential` flag / income-recategorization (search "essential"). Add/adjust to record:

```markdown
- **Essential spend is now category-derived, but categorization is still manual (2026-07-22).** `essentialForCategory` unlocks the score once transactions are categorized (v1.1), but there is still no manual per-transaction `essential` override (`TransactionOverride` carries only `category`/`description`), and CSV import defaults outflows to `other` (non-essential). AI-assisted categorization + a manual essential override are slice B.
```

- [ ] **Step 4: Update CURRENT_PHASE.md**

In `docs/CURRENT_PHASE.md`, update the "_Last updated_" line and next-priorities to record slice A landed and slice B is queued. Add a bullet noting the "highest-impact action / next-best-action" idea (incl. HYSA nudge) already lives in the roadmap at Phase 4 (recommendation cards) / Phase 5 (highest-impact action engine) — nothing to build now.

- [ ] **Step 5: Run the full check**

Run: `pnpm check`
Expected: lint + typecheck + all tests + build green.

- [ ] **Step 6: Commit**

```bash
git add docs/FINANCIAL_HEALTH_SCORE.md docs/DECISIONS.md docs/KNOWN_LIMITATIONS.md docs/CURRENT_PHASE.md
git commit -m "docs: record category-derived essential (v1.1) + slice B follow-up"
```

---

## Self-Review notes

- **Spec coverage:** helper (Task 1), single call-site derivation with flag-wins semantics (Task 2), version bump + normative/decision/limitation docs + suppression→unlock proof (Tasks 3–4), honest CSV-import limitation recorded (Task 4 Steps 2–3). All spec sections covered.
- **Location deviation from spec:** helper placed in the engine, not `config/categories.ts` — the spec explicitly permitted "a framework-free engine helper," and this avoids the engine's first `config/` import (extraction rule).
- **Type consistency:** `essentialForCategory(category: string | null): boolean` used identically in Task 1 (definition), Task 2 (call site), and tests. `ScoreTransactionInput.category` is `string | null` and `.essential` is `boolean | null`, matching the `??` guard.
