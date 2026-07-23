# Academy content-refinement Slice C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the 4 remaining glossary-only Academy concepts (short-term-obligations, financial-flexibility, retained-cash, capital-allocation) to the Available Capital definition-sheet reference, content-only.

**Architecture:** Pure content edits to 4 files in `src/lib/concepts/content/`, each gaining only the fields the definition sheet actually renders (`plainEnglishSummary`, `whereUsed`, and `formulaRows`+`formula` where a real equation exists). A growing `content.test.ts` guardrail proves each migration; the existing `e2e/academy.spec.ts` glossary-sheet test is strengthened to assert the new "Where it appears" section. No resolver, schema, component, registry, or route changes.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e), pnpm.

## Global Constraints

- **Content-only.** Do not touch `src/lib/data/concept-live.ts`, `src/lib/concepts/types.ts`, `registry.ts`, `modules.ts`, `term-sheet.ts`, or any React component. No new resolver namespaces.
- **Rendered-fields-only.** Add `plainEnglishSummary`, `whereUsed`, and (where an equation exists) `formulaRows`+`formula`. Do **not** add `memorableDistinction`, `comparisonRows`, or `interpretation` — they don't render on a glossary sheet.
- **Keep `fullDefinition`** in every file. `content.test.ts` asserts both `shortDefinition` and `fullDefinition` are truthy for these 4 concepts; the view model just stops rendering `fullDefinition` once `plainEnglishSummary` is present.
- **`formulaRows` requires a `formula` string alongside it** (registry validation enforces this). `whereUsed` entries must be non-empty strings.
- **No internal-engineering language** in any concept field. `content.test.ts` bans `/audit ruling/i`, `/spec finding/i`, `/\btask \d/i`, `/decisions #/i`, `/implementation plan/i` in every serialized concept.
- **Do not change** each concept's `id`, `title`, `classification`, lesson-absence, `dataMetricKey`, or `status`. Classifications are locked by `content.test.ts`.
- Preserve each file's existing prose in `fullDefinition`/`whyItMatters`/`businessContext`/`commonMisunderstanding` unless this plan gives replacement text.
- Run unit tests with `pnpm test` (Vitest). Full gate is `pnpm check` (lint + typecheck + unit + build).
- **Reference file:** `src/lib/concepts/content/available-capital.ts` (the migrated glossary sheet this slice mirrors).

---

### Task 1: Migrate `retained-cash` (richest — formula + live block)

**Files:**
- Modify: `src/lib/concepts/content/retained-cash.ts`
- Test: `src/lib/concepts/content.test.ts`

**Interfaces:**
- Consumes: `FinancialConcept` (from `../types`), `ALL_CONCEPTS` (from `./content`).
- Produces: `retainedCash` concept with `plainEnglishSummary`, `formula`, `formulaRows`, `whereUsed`. A new `describe("Slice C — glossary definition-sheet migration")` block in `content.test.ts` (later tasks append rows to its `it.each` table).

- [ ] **Step 1: Add the failing guardrail test**

Append this block to `src/lib/concepts/content.test.ts`, inside the top-level `describe("authored content", ...)` (after the last `it`):

```ts
  describe("Slice C — glossary definition-sheet migration", () => {
    it.each([
      { id: "retained-cash", formula: true },
    ])("$id carries the definition-sheet fields", ({ id, formula }) => {
      const c = ALL_CONCEPTS.find((x) => x.id === id);
      expect(c?.plainEnglishSummary, id).toBeTruthy();
      expect(c?.whereUsed?.length ?? 0, id).toBeGreaterThan(0);
      if (formula) {
        expect(c?.formulaRows?.length ?? 0, id).toBeGreaterThan(0);
        expect(c?.formula, id).toBeTruthy();
      }
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/lib/concepts/content.test.ts -t "definition-sheet fields"`
Expected: FAIL — `retained-cash` has no `plainEnglishSummary`/`whereUsed`/`formulaRows` yet (`toBeTruthy` fails).

- [ ] **Step 3: Rewrite `retained-cash.ts`**

Replace the whole file with:

```ts
// src/lib/concepts/content/retained-cash.ts
import type { FinancialConcept } from "../types";

export const retainedCash: FinancialConcept = {
  id: "retained-cash",
  title: "Retained cash",
  classification: "household_adaptation" as const,
  shortDefinition: "The portion of free cash flow your household kept as cash rather than allocating elsewhere.",
  plainEnglishSummary:
    "The slice of your free cash flow that stayed as cash — not moved into investments and not used to pay down debt beyond the minimum. It's the numerator of your savings rate.",
  fullDefinition:
    "Retained cash is the slice of a household's free cash flow that stayed as cash — not sent to an investment account and not used to pay down debt beyond the required minimum. It's the numerator in the savings rate: retained cash divided by revenue produces the savings-rate percentage.",
  whyItMatters:
    "Free cash flow can be directed in more than one way, and retained cash isolates just the cash-building piece of that decision. Understanding it separately from free cash flow itself avoids assuming that all money left over after expenses simply piles up as cash — often it doesn't, by design.",
  formula: "Free cash flow − investment contributions − debt reduction = retained cash",
  formulaRows: [
    { label: "Free cash flow" },
    { label: "Investment contributions", operator: "-" },
    { label: "Debt reduction", operator: "-" },
    { label: "Retained cash", operator: "=" },
  ],
  businessContext:
    "The corporate cousin of this idea is “retained earnings” — the portion of a company's profit that management chooses to keep rather than pay out or reinvest elsewhere. A household's retained cash is the same choice applied at household scale.",
  whereUsed: ["Report (Savings line, under “Allocated to”)", "Savings rate"],
  relatedConceptIds: ["free-cash-flow", "savings-rate", "capital-allocation"],
  prerequisiteConceptIds: [],
  dataMetricKey: "report:savings",
  status: "published",
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- src/lib/concepts/content.test.ts`
Expected: PASS — the new `retained-cash` case is green and every pre-existing `content.test.ts` assertion (registry validation, "keeps glossary-only records lesson-free but tappable", classification table, internal-language ban, "16 concepts, 11 with lessons") still passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts/content/retained-cash.ts src/lib/concepts/content.test.ts
git commit -m "content(academy): migrate retained-cash to the definition-sheet pattern"
```

---

### Task 2: Migrate `financial-flexibility` (formula + householdAdaptation, no live block)

**Files:**
- Modify: `src/lib/concepts/content/financial-flexibility.ts`
- Test: `src/lib/concepts/content.test.ts`

**Interfaces:**
- Consumes: the `it.each` table added in Task 1.
- Produces: `financialFlexibility` with `plainEnglishSummary`, `formula`, `formulaRows`, `householdAdaptation`, `whereUsed`.

- [ ] **Step 1: Extend the guardrail table (failing)**

In `content.test.ts`, add one row to the Slice C `it.each` table so it reads:

```ts
    it.each([
      { id: "retained-cash", formula: true },
      { id: "financial-flexibility", formula: true },
    ])("$id carries the definition-sheet fields", ({ id, formula }) => {
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/concepts/content.test.ts -t "definition-sheet fields"`
Expected: FAIL — `financial-flexibility` has no `plainEnglishSummary`/`formulaRows` yet.

- [ ] **Step 3: Rewrite `financial-flexibility.ts`**

Replace the whole file with:

```ts
// src/lib/concepts/content/financial-flexibility.ts
import type { FinancialConcept } from "../types";

export const financialFlexibility: FinancialConcept = {
  id: "financial-flexibility",
  title: "Financial flexibility",
  classification: "household_adaptation" as const,
  shortDefinition: "Your household's room to absorb surprises or seize opportunities without borrowing.",
  plainEnglishSummary:
    "The room your household has to handle a surprise — a repair, a slow month — or to act on an opportunity, without taking on new debt. PFI measures it as your cushion above the financial waterline.",
  fullDefinition:
    "Financial flexibility is the room a household has to handle the unexpected — a repair, a medical bill, a slow month — or to act on an opportunity, without having to take on new debt. It draws on several things at once: how liquid a household's assets are, how much of its income is already committed to short-term obligations, and how much pressure existing debt already creates.",
  whyItMatters:
    "Two households with identical net worth can have very different flexibility. One with cash on hand and light debt payments can weather a surprise easily; one with the same net worth locked into illiquid assets and heavy required payments has far less room to maneuver.",
  formula: "Available capital − financial waterline = cushion",
  formulaRows: [
    { label: "Available capital" },
    { label: "Financial waterline", operator: "-" },
    { label: "Cushion", operator: "=" },
  ],
  householdAdaptation:
    "PFI quantifies flexibility as your cushion — how far your available capital sits above your financial waterline, the level below which your household would start to feel pressure.",
  businessContext:
    "This is why companies hold cash reserves and maintain credit lines even when profitable — flexibility protects against the unexpected in a way that raw profitability alone doesn't. A profitable company with no cash cushion can still be caught short by a single bad quarter.",
  whereUsed: ["Home dashboard (Cushion card)"],
  relatedConceptIds: ["liquidity", "free-cash-flow", "available-capital"],
  prerequisiteConceptIds: [],
  dataMetricKey: "position:cushion",
  status: "published",
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- src/lib/concepts/content.test.ts`
Expected: PASS — `retained-cash` and `financial-flexibility` cases green; all pre-existing assertions still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts/content/financial-flexibility.ts src/lib/concepts/content.test.ts
git commit -m "content(academy): migrate financial-flexibility to the definition-sheet pattern"
```

---

### Task 3: Migrate `short-term-obligations` (no formula, no live block)

**Files:**
- Modify: `src/lib/concepts/content/short-term-obligations.ts`
- Test: `src/lib/concepts/content.test.ts`

**Interfaces:**
- Produces: `shortTermObligations` with `plainEnglishSummary`, `whereUsed` (no `formulaRows`).

- [ ] **Step 1: Extend the guardrail table (failing)**

Add a row (`formula: false`) so the table reads:

```ts
    it.each([
      { id: "retained-cash", formula: true },
      { id: "financial-flexibility", formula: true },
      { id: "short-term-obligations", formula: false },
    ])("$id carries the definition-sheet fields", ({ id, formula }) => {
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/concepts/content.test.ts -t "definition-sheet fields"`
Expected: FAIL — `short-term-obligations` has no `plainEnglishSummary`/`whereUsed` yet.

- [ ] **Step 3: Rewrite `short-term-obligations.ts`**

Replace the whole file with:

```ts
// src/lib/concepts/content/short-term-obligations.ts
import type { FinancialConcept } from "../types";

export const shortTermObligations: FinancialConcept = {
  id: "short-term-obligations",
  title: "Short-term obligations",
  classification: "standard_finance" as const,
  shortDefinition: "Payments your household is committed to before your next expected income.",
  plainEnglishSummary:
    "The payments your household is already committed to before its next expected income arrives — rent, a loan payment, a card minimum. Only the slice due now, not the full balance owed.",
  fullDefinition:
    "Short-term obligations are the payments a household is already committed to make before its next expected income arrives — rent or a mortgage installment, a loan payment, a credit-card minimum, or any other bill already due. They are distinct from total liabilities: a liability is the full balance owed, while a short-term obligation is only the slice of it that's due right now.",
  whyItMatters:
    "Short-term obligations determine how much of a household's current liquid assets are actually free to use. Money sitting in an account can look available while already being committed to an obligation due in a few days — knowing the difference prevents treating committed money as spendable.",
  businessContext:
    "This is the same idea as “current liabilities” on a company's balance sheet — the portion of what a business owes that comes due within the next operating period, tracked separately from longer-term debt because it demands cash sooner.",
  commonMisunderstanding:
    "Money sitting in an account is not automatically available. If a chunk of that balance is already committed to a bill or payment due before the next paycheck, it isn't really free to spend or save elsewhere, even though the account balance looks unchanged until the payment goes out.",
  whereUsed: ["Home dashboard (Obligations card)", "Available capital"],
  relatedConceptIds: ["liquidity", "available-capital", "debt-pressure"],
  prerequisiteConceptIds: [],
  dataMetricKey: "snapshot:nearTermObligations",
  status: "published",
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- src/lib/concepts/content.test.ts`
Expected: PASS — three Slice C cases green; all pre-existing assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts/content/short-term-obligations.ts src/lib/concepts/content.test.ts
git commit -m "content(academy): migrate short-term-obligations to the definition-sheet pattern"
```

---

### Task 4: Migrate `capital-allocation` (no formula, no live block)

**Files:**
- Modify: `src/lib/concepts/content/capital-allocation.ts`
- Test: `src/lib/concepts/content.test.ts`

**Interfaces:**
- Produces: `capitalAllocation` with `plainEnglishSummary`, `whereUsed` (no `formulaRows`, no `dataMetricKey`).

- [ ] **Step 1: Extend the guardrail table (failing)**

Add the final row so the table reads:

```ts
    it.each([
      { id: "retained-cash", formula: true },
      { id: "financial-flexibility", formula: true },
      { id: "short-term-obligations", formula: false },
      { id: "capital-allocation", formula: false },
    ])("$id carries the definition-sheet fields", ({ id, formula }) => {
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/lib/concepts/content.test.ts -t "definition-sheet fields"`
Expected: FAIL — `capital-allocation` has no `plainEnglishSummary`/`whereUsed` yet.

- [ ] **Step 3: Rewrite `capital-allocation.ts`**

Replace the whole file with:

```ts
// src/lib/concepts/content/capital-allocation.ts
import type { FinancialConcept } from "../types";

export const capitalAllocation: FinancialConcept = {
  id: "capital-allocation",
  title: "Capital allocation",
  classification: "standard_finance" as const,
  shortDefinition: "Deciding where your free cash flow goes — cash savings, investments, or debt paydown.",
  plainEnglishSummary:
    "The decision about where your free cash flow goes — kept as cash, invested, or used to pay down debt. The same dollar can only go to one of them, which makes it a real choice with tradeoffs.",
  fullDefinition:
    "Capital allocation is the decision a household makes about where to direct its free cash flow: keeping it as cash, investing it, or using it to pay down debt beyond the required minimum. The same dollar of free cash flow can only go to one of these at a time, which makes allocation a genuine choice with tradeoffs rather than a single automatic outcome.",
  whyItMatters:
    "Two households can generate identical free cash flow and end up in very different positions depending on how they allocate it. Neither more retained cash nor more investment nor more debt paydown is automatically the “right” choice — the right allocation depends on a household's own flexibility, obligations, and goals.",
  businessContext:
    "Many investors consider capital allocation the most important job of a company's CEO — deciding whether profit goes to dividends, buybacks, debt reduction, or reinvestment. Households make an equivalent decision every month, just at a different scale.",
  whereUsed: ["Report (“Allocated to” breakdown, under Free cash flow)"],
  relatedConceptIds: ["free-cash-flow", "retained-cash", "savings-rate"],
  prerequisiteConceptIds: [],
  status: "published",
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- src/lib/concepts/content.test.ts`
Expected: PASS — all four Slice C cases green; all pre-existing assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts/content/capital-allocation.ts src/lib/concepts/content.test.ts
git commit -m "content(academy): migrate capital-allocation to the definition-sheet pattern"
```

---

### Task 5: Strengthen the e2e glossary-sheet assertion

**Files:**
- Modify: `e2e/academy.spec.ts` (the `test("glossary-only row opens the definition sheet, not a lesson", ...)` block, ~lines 38–45)

**Interfaces:**
- Consumes: `short-term-obligations` now carrying `whereUsed` (Task 3), which makes the sheet render its "Where it appears" section.

- [ ] **Step 1: Add the "Where it appears" assertion**

In `e2e/academy.spec.ts`, inside the existing glossary-sheet test, add the new assertion immediately after the existing `Why it matters` line. The block becomes:

```ts
test("glossary-only row opens the definition sheet, not a lesson", async () => {
  await page.getByRole("button", { name: /Short-term obligations/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: /lesson/i })).toHaveCount(0); // no CTA on glossary terms
  await expect(dialog.getByText("Why it matters")).toBeVisible(); // un-gated for glossary concepts too
  await expect(dialog.getByText("Where it appears")).toBeVisible(); // Slice C: migrated glossary sheet lists its surfaces
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
```

- [ ] **Step 2: Run this e2e test to verify it passes**

Run: `pnpm test:e2e -- academy.spec.ts -g "glossary-only row opens the definition sheet"`
Expected: PASS — the migrated Short-term obligations sheet now renders "Where it appears".
(If the local environment can't reach Supabase for the e2e fixture, note it and rely on the live-QA gate in Task 7; do not weaken the assertion.)

- [ ] **Step 3: Commit**

```bash
git add e2e/academy.spec.ts
git commit -m "test(e2e): assert migrated glossary sheet renders Where it appears"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/DECISIONS.md` (append entry #42)
- Modify: `docs/KNOWN_LIMITATIONS.md` (record deferred resolver support)
- Modify: `docs/CURRENT_PHASE.md` (record Slice C complete; advance Next priorities)

- [ ] **Step 1: Append DECISIONS #42**

Add to the end of `docs/DECISIONS.md`:

```markdown
## 42. 2026-07-23 — Academy content-refinement Slice C: 4 glossary definition sheets migrated, content-only

**Context.** Slices A/B migrated all 11 lessons and the Available Capital reference sheet to the refined Academy content schema. Four glossary-only concepts remained on the pre-refinement shape: short-term-obligations, financial-flexibility, retained-cash, capital-allocation (all Module 3, "Financial Pressure and Flexibility").

**Decision.** Migrate the four to the Available Capital definition-sheet reference, **content-only** — no resolver, schema, component, or registry changes. Author only the fields the definition sheet actually renders (`plainEnglishSummary`, `whereUsed`, and `formulaRows`+`formula` where a genuine equation exists); skip `memorableDistinction`/`comparisonRows`/`interpretation`, which are lesson-only and do not render on a glossary sheet. Keep `fullDefinition` in the data (the view model stops rendering it once `plainEnglishSummary` is present, but `content.test.ts` requires it).

**Formula rows** were added only where a real engine equation exists: retained-cash (`Free cash flow − investment contributions − debt reduction = retained cash`, matching `report.ts`'s allocation narration) and financial-flexibility (`Available capital − financial waterline = cushion`, matching `position.ts`). short-term-obligations (a raw component of Available Capital) and capital-allocation (a decision, no arithmetic) get none.

**Live "Your data" block:** only retained-cash renders one, via `report:savings`, which the Slice A resolver already handles. short-term-obligations (`snapshot:nearTermObligations` — the snapshot resolver handles `netWorth` only), financial-flexibility (`position:cushion` — unresolved), and available-capital (`position:availablePosition` — unresolved) stay purely definitional, matching the reference sheet. Extending the resolver to those namespaces is deferred to a possible later resolver-completion slice (see KNOWN_LIMITATIONS).

**Consequence.** Every tappable term in PFI now reads as a plain-English definition sheet with a "Where it appears" list. The Academy content-refinement track is complete; remaining Phase 4.5 work is Slice 4 (personalization + analytics).
```

- [ ] **Step 2: Add the KNOWN_LIMITATIONS entry**

In `docs/KNOWN_LIMITATIONS.md`, under the Academy-related section (or add a `## Academy content-refinement (2026-07-23)` heading if none fits), add:

```markdown
- **Three migrated definition sheets carry a `dataMetricKey` the `concept-live` resolver doesn't resolve, so they render no live "Your data" block (2026-07-23, Slice C).** short-term-obligations (`snapshot:nearTermObligations` — the snapshot resolver handles `netWorth` only), financial-flexibility (`position:cushion`), and available-capital (`position:availablePosition`) carry a metric binding but display definition-only, unlike retained-cash (`report:savings`, resolved). This matches the reference sheet's behavior and was an explicit content-only scoping decision for Slice C (DECISIONS #42). A later "resolver-completion" slice could add `snapshot:*`/`position:*` support so these sheets render live household figures too; until then the binding is inert on the sheet.
```

- [ ] **Step 3: Update CURRENT_PHASE.md**

Make these three edits:

1. **Phase line** — at the end of the long `**Phase:** …` narrative (the `→ the Academy content-refinement Slice B …` clause), append:
   `→ the **Academy content-refinement Slice C — 4 glossary definition sheets migrated — complete** (DECISIONS #42; branch worktree-academy-content-sliceC): short-term-obligations, financial-flexibility, retained-cash, and capital-allocation migrated to the Available Capital definition-sheet reference (plainEnglishSummary + whereUsed on all four; formulaRows on retained-cash and financial-flexibility), content-only with no resolver changes — completing the Academy content-refinement track.`

2. **Add a "Completed" section** immediately after the Slice B completed section:

```markdown
## Completed (this phase — Academy content-refinement Slice C: 4 glossary definition sheets)

The final Academy content slice migrates the 4 remaining glossary-only concepts
(short-term-obligations, financial-flexibility, retained-cash, capital-allocation
— all Module 3) to the Available Capital definition-sheet reference. Content-only;
DECISIONS #42.

- **Rendered-fields-only.** Each concept gained `plainEnglishSummary` (upgrades
  the sheet's summary line and drops the raw `fullDefinition` block) and
  `whereUsed` (a new "Where it appears" section). `formulaRows`+`formula` were
  added where a real engine equation exists: retained-cash (`Free cash flow −
  investment contributions − debt reduction`) and financial-flexibility
  (`Available capital − financial waterline = cushion`); short-term-obligations
  and capital-allocation have no formula. No `memorableDistinction`/
  `comparisonRows`/`interpretation` — those are lesson-only and don't render on a
  glossary sheet.
- **Live "Your data" block:** only retained-cash renders one (`report:savings`,
  already resolved). The other three stay definitional, matching the reference —
  their `snapshot:`/`position:` bindings are unresolved by design this slice (see
  KNOWN_LIMITATIONS). No `concept-live.ts` change.
- **Tests.** A new `content.test.ts` guardrail asserts all four carry
  `plainEnglishSummary` + `whereUsed` (+ `formulaRows`/`formula` for the two with
  equations); the existing `e2e/academy.spec.ts` glossary-sheet test now also
  asserts the "Where it appears" section renders. See "Test status" below.
```

3. **Next priorities** — remove the "Academy content-refinement Slice C" item (it's now done) and update the surrounding text so Academy Slice 4 (personalization + analytics) is the next Academy item; update the "Recently completed" list to add a Slice C bullet mirroring the Slice B bullet's style.

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md docs/KNOWN_LIMITATIONS.md docs/CURRENT_PHASE.md
git commit -m "docs(academy): record Slice C — 4 glossary definition sheets migrated"
```

---

### Task 7: Whole-branch verification (gate before review)

**Files:** none (verification only; append the Test-status paragraph to `docs/CURRENT_PHASE.md` if not already added in Task 6).

- [ ] **Step 1: Full check gate**

Run: `pnpm check`
Expected: lint 0 errors (pre-existing `AccountSheet.tsx` + `CompanyProfileSheet.tsx` React-Compiler warnings only), typecheck clean, all unit tests pass (count = current baseline + 4 new `it.each` cases), build succeeds with 23 routes (unchanged — no new routes).

- [ ] **Step 2: Live browser QA (390×844 first, then 1280×900)**

Using the project's established live-QA pattern (gstack `browse`; dev server on a scratch port; an ephemeral password user via `e2e/fixtures/password-user.ts`'s `createPasswordUser`, signed in through the real `/login`; a demo profile loaded), confirm each sheet at both viewports:

- **`/report` → tap the "Savings (retained cash)" row** → retained-cash sheet shows the new plain-English summary, the `Free cash flow − investment contributions − debt reduction = Retained cash` formula block, "Where it appears", **and a live "Your data" block with a real figure**.
- **`/` (dashboard) → tap the "Obligations" card** → short-term-obligations sheet shows the summary + "Where it appears", **no** live block.
- **`/` (dashboard) → tap the "Cushion" card** → financial-flexibility sheet shows the summary, the `Available capital − financial waterline = Cushion` formula block, "Where it appears", **no** live block.
- **`/academy` → tap the "Capital allocation" row** → capital-allocation sheet shows the summary + "Where it appears", **no** formula block, **no** live block.

For every sheet: `document.documentElement.scrollWidth === document.documentElement.clientWidth` at 390px (no horizontal overflow), and zero console errors. Delete the ephemeral user and any scratch scripts, and stop the dev server afterward.

- [ ] **Step 3: Record the verification**

Add a "Test status" paragraph to `docs/CURRENT_PHASE.md` capturing the `pnpm check` counts and the live-QA account (mirroring the Slice B entry's format), then commit:

```bash
git add docs/CURRENT_PHASE.md
git commit -m "docs(academy): record Slice C verification"
```

---

## Notes for the executor

- Tasks 1–4 are independent content edits sharing one growing `content.test.ts` table; each ends fully green and is independently reviewable.
- Do not run the whole `pnpm check` until Task 7 to keep per-task cycles fast, but `pnpm test -- src/lib/concepts/content.test.ts` after each content task is required.
- After all tasks, the branch is ready for a whole-branch code review and merge (this project's normal gate — out of scope for the tasks themselves).
