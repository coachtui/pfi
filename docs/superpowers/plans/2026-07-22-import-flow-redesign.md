# Import Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the PDF-import duplicate-whitelist integrity bug and give the whole account-import flow a premium UX pass aligned to the app's dark stock-terminal design system.

**Architecture:** One data-integrity fix in the PDF confirm path (unique per-row `line` numbers, extracted into a pure tested helper), then a series of focused UI changes across the import surfaces — a shared error primitive, a segmented stepper, an intentional empty-dashboard handoff, honest CTA labels, real Back affordances, and a rebuilt review screen (table → card list) with actionable dead-ends. Structure and financial logic are unchanged.

**Tech Stack:** Next.js 16 App Router, TypeScript (strict), Tailwind 4 (semantic tokens in `src/app/globals.css`), Zod, Vitest (node env — no React Testing Library), Supabase, lucide-react icons, pnpm.

## Global Constraints

- **Deterministic code calculates; AI only narrates.** No financial formula in a React component. This slice touches no financial-engine math.
- **Design tokens live only in `src/app/globals.css`.** Components reference semantic token utilities (`bg-elevated`, `text-secondary`, `border-border-subtle`, `rounded-card`, `shadow-card`, `bg-positive-strong`, `text-warning`, etc.). Do not introduce raw hex.
- **Never communicate positive/negative state through color alone** — always pair with icon, sign, or text.
- **Mobile-first, always.** Design and verify at ~390px before desktop.
- **Solid emerald (`bg-positive-strong`) is used once per screen**, on the single primary action; secondary actions are ghost/outline/text. Muted/decorative emerald tints (`bg-positive-strong/10`, `bg-positive-muted`, `text-positive-strong` on an icon, a "good" status chip) are not subject to this cap — they're a distinct, softer visual weight from a solid primary CTA and may appear alongside it (e.g. the upload screen's dropzone icon, the review screen's "Reconciled" chip), matching the approved mockup. _(Clarified 2026-07-22 after Task 6 review flagged the upload icon tile against a too-strict literal reading; user confirmed muted tints are exempt.)_
- **All money/balances/masks use monospace tabular numerics** (`font-mono` + `tabular-nums` or the `.tabular` class) and are signed + colored by direction where a sign applies.
- **No new migrations.** `line` is a transient view-model field, never persisted.
- **CSV path behavior is unchanged** except for shared UI primitives (stepper, `InlineError`) it already routes through.
- **UI tasks are gated on `pnpm check` (lint + typecheck + test + build) plus in-browser visual verification at ~390px and desktop.** There is no React unit-test harness; do not invent one. Logic tasks are gated on Vitest unit tests.
- Every commit message ends with the project's `Co-Authored-By` trailer.
- `/ui-ux-pro-max` drives component-level visual refinement; the approved direction is the mockup (artifact `cb950881`). Refine within the constraints above.

---

### Task 1: Unique staged line numbers (PDF duplicate-integrity fix)

Fixes the bug where `readPdfReview` stamps every staged transaction with `line: 2`, so accepting any one duplicate whitelists all rows against the commit-side exact-dedupe guard. Extract the staged-row → review-transaction mapping into a pure, tested helper that assigns unique line numbers starting at 2 (matching the CSV convention where header = line 1, first data row = line 2, satisfying `importRowSchema.line >= 2`).

**Files:**
- Create: `src/lib/pdf-import/review-rows.ts`
- Create: `src/lib/pdf-import/review-rows.test.ts`
- Modify: `src/app/actions/imports.ts` (the `readPdfReview` function — the staged query near line 271 and the `transactions:` mapping near lines 321–338)

**Interfaces:**
- Consumes: `ReviewTransaction`, `ConfidenceLevel`, `FieldConfidence`, `categoryForDirection` from `@/lib/pdf-import/types`; `Category` from `@/lib/config/categories`.
- Produces: `mapStagedRowsToReviewTransactions(rows: StagedTransactionRow[]): ReviewTransaction[]` and the `StagedTransactionRow` interface.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pdf-import/review-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapStagedRowsToReviewTransactions, type StagedTransactionRow } from "./review-rows";

function row(partial: Partial<StagedTransactionRow>): StagedTransactionRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    posted_date: "2026-06-01",
    transaction_date: null,
    amount: 10,
    direction: "outflow",
    description: "Test",
    category: null,
    reference_number: null,
    source_page: 1,
    confidence: "high",
    field_confidence: null,
    issues: null,
    excluded: false,
    duplicate_of_transaction_id: null,
    ...partial,
  };
}

describe("mapStagedRowsToReviewTransactions", () => {
  it("assigns unique line numbers starting at 2 (never a shared constant)", () => {
    const out = mapStagedRowsToReviewTransactions([
      row({ id: "a" }),
      row({ id: "b" }),
      row({ id: "c" }),
    ]);
    expect(out.map((r) => r.line)).toEqual([2, 3, 4]);
    expect(new Set(out.map((r) => r.line)).size).toBe(3);
  });

  it("defaults category by direction when null", () => {
    const [inflow, outflow] = mapStagedRowsToReviewTransactions([
      row({ direction: "inflow", category: null }),
      row({ direction: "outflow", category: null }),
    ]);
    expect(inflow.category).toBe("income");
    expect(outflow.category).toBe("other");
  });

  it("coerces amount to number and normalizes issues to a string array", () => {
    const [r] = mapStagedRowsToReviewTransactions([
      row({ amount: "84.20" as unknown as number, issues: ["a", 1, null, "b"] }),
    ]);
    expect(r.amount).toBe(84.2);
    expect(r.issues).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/pdf-import/review-rows.test.ts`
Expected: FAIL — cannot resolve `./review-rows`.

- [ ] **Step 3: Write the pure helper**

Create `src/lib/pdf-import/review-rows.ts`:

```ts
import type { Category } from "@/lib/config/categories";
import { categoryForDirection, type ConfidenceLevel, type FieldConfidence, type ReviewTransaction } from "./types";

/** Shape of a `staged_transactions` DB row as read by `readPdfReview`. */
export interface StagedTransactionRow {
  id: string;
  posted_date: string;
  transaction_date: string | null;
  amount: number | string;
  direction: "inflow" | "outflow";
  description: string;
  category: Category | null;
  reference_number: string | null;
  source_page: number | null;
  confidence: ConfidenceLevel;
  field_confidence: FieldConfidence | null;
  issues: unknown;
  excluded: boolean;
  duplicate_of_transaction_id: string | null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Map staged DB rows to review-transaction view models, assigning each a
 * unique 1-based `line` (first row = 2, matching the CSV convention where the
 * notional header is line 1). Unique lines are required: `commitImportedTransactions`
 * keys its exact-dedupe whitelist on `line`, so a shared constant leaks the
 * "import duplicate" decision across every row.
 */
export function mapStagedRowsToReviewTransactions(rows: StagedTransactionRow[]): ReviewTransaction[] {
  return rows.map((r, idx) => ({
    stagedId: r.id,
    line: idx + 2,
    postedDate: r.posted_date,
    transactionDate: r.transaction_date,
    amount: Number(r.amount),
    direction: r.direction,
    description: r.description,
    category: r.category ?? categoryForDirection(r.direction),
    referenceNumber: r.reference_number,
    sourcePage: r.source_page,
    confidence: r.confidence,
    fieldConfidence: r.field_confidence ?? {},
    issues: toStringArray(r.issues),
    excluded: r.excluded,
    duplicateOfTransactionId: r.duplicate_of_transaction_id,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/pdf-import/review-rows.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the helper into `readPdfReview` and make ordering deterministic**

In `src/app/actions/imports.ts`:

1. Add the import near the other pdf-import imports (top of file):
```ts
import { mapStagedRowsToReviewTransactions } from "@/lib/pdf-import/review-rows";
```
2. In `readPdfReview`, make the staged-transactions query a stable total order by adding an `id` tiebreaker (currently ordered by `posted_date` only, which can tie and shuffle line numbers between reloads):
```ts
supabase.from("staged_transactions").select("*").eq("import_batch_id", importId)
  .order("posted_date", { ascending: true }).order("id", { ascending: true }),
```
3. Replace the inline `transactions: (staged ?? []).map((r) => ({ ... line: 2 ... }))` block in the returned object with:
```ts
transactions: mapStagedRowsToReviewTransactions((staged ?? []) as StagedTransactionRow[]),
```
Add `StagedTransactionRow` to the `review-rows` import: `import { mapStagedRowsToReviewTransactions, type StagedTransactionRow } from "@/lib/pdf-import/review-rows";`. If `asStringArray` and `categoryForDirection` are now unused in `imports.ts`, remove the dead imports/usages the lint step flags.

- [ ] **Step 6: Verify the whole suite and build**

Run: `pnpm check`
Expected: lint 0 errors, typecheck clean, all vitest tests pass (including the 3 new), build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pdf-import/review-rows.ts src/lib/pdf-import/review-rows.test.ts src/app/actions/imports.ts
git commit -m "fix(imports): give staged PDF rows unique line numbers

Every staged row was stamped line:2, so accepting one 'import duplicate'
whitelisted all rows against the commit-side exact-dedupe guard, allowing
true duplicates to double-import. Extract the staged-row mapping into a pure
tested helper that assigns unique lines (idx+2), and make the staged query a
stable total order.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shared `InlineError` primitive + replace literal "x" errors

Two error renders print a literal `x ` glyph before the message (`PdfUploadStep.tsx:76`, `PdfReviewStep.tsx:309`) — state communicated by a bare character. Replace with one accessible primitive (icon + text, `role="alert"`).

**Files:**
- Create: `src/components/ui/InlineError.tsx`
- Modify: `src/app/import/PdfUploadStep.tsx` (the `{error && ...}` render, ~line 76)
- Modify: `src/app/import/PdfReviewStep.tsx` (the `{error && ...}` render, ~line 309)

**Interfaces:**
- Produces: `InlineError({ message }: { message: string })` — returns null when message is empty.

- [ ] **Step 1: Create the primitive**

Create `src/components/ui/InlineError.tsx`:

```tsx
import { AlertCircle } from "lucide-react";

/** Inline form/action error. Pairs an icon with text so state is never color-only. */
export function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-negative/30 bg-negative-muted px-3 py-2 text-sm text-negative"
    >
      <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
```

- [ ] **Step 2: Replace the PdfUploadStep error render**

In `src/app/import/PdfUploadStep.tsx`, add the import:
```tsx
import { InlineError } from "@/components/ui/InlineError";
```
Replace:
```tsx
{error && <p role="alert" className="text-sm text-negative">x {error}</p>}
```
with:
```tsx
<InlineError message={error} />
```

- [ ] **Step 3: Replace the PdfReviewStep error render**

In `src/app/import/PdfReviewStep.tsx`, add the same import, and replace:
```tsx
{error && <p role="alert" className="text-sm text-negative">x {error}</p>}
```
with:
```tsx
<InlineError message={error} />
```

- [ ] **Step 4: Grep for any other literal-glyph error renders**

Run: `grep -rn '">x ' src/app/import src/app/accounts src/components`
Expected: no remaining matches. Route any found through `InlineError`.

- [ ] **Step 5: Verify and visually check**

Run: `pnpm check` → green.
Visually: trigger a PDF upload error (e.g. upload a non-PDF) at ~390px and confirm the icon+text error renders with no stray "x".

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/InlineError.tsx src/app/import/PdfUploadStep.tsx src/app/import/PdfReviewStep.tsx
git commit -m "feat(import): shared InlineError primitive; drop literal 'x' error glyph

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Segmented import stepper

Replace the `1. 2. 3.` numbered `<ol>` in `ImportWizard` with a segmented progress indicator: filled/current/upcoming segments plus a named current step and "Step N of M".

**Files:**
- Create: `src/app/import/ImportStepper.tsx`
- Modify: `src/app/import/ImportWizard.tsx` (the `<ol>...</ol>` block, ~lines 230–240)

**Interfaces:**
- Consumes: the existing `steps: Step[]`, `step: Step`, and `STEP_LABELS` in `ImportWizard`.
- Produces: `ImportStepper({ steps, current, labels })` where `steps: readonly string[]`, `current: string`, `labels: Record<string, string>`.

- [ ] **Step 1: Create the stepper component**

Create `src/app/import/ImportStepper.tsx`:

```tsx
export function ImportStepper<T extends string>({
  steps,
  current,
  labels,
}: {
  steps: readonly T[];
  current: T;
  labels: Record<T, string>;
}) {
  const index = Math.max(0, steps.indexOf(current));
  return (
    <div className="mb-6 flex flex-col gap-2" aria-label="Import progress">
      <div className="flex gap-1" aria-hidden>
        {steps.map((s, i) => (
          <span
            key={s}
            className={`h-[3px] flex-1 rounded-full ${
              i < index ? "bg-positive-strong" : i === index ? "bg-positive" : "bg-border-subtle"
            }`}
          />
        ))}
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-primary">{labels[current]}</span>
        <span className="font-mono text-xs text-tertiary">
          Step {index + 1} of {steps.length}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into ImportWizard**

In `src/app/import/ImportWizard.tsx`, add the import:
```tsx
import { ImportStepper } from "./ImportStepper";
```
Replace the entire `<ol className="mb-6 ...">...</ol>` block with:
```tsx
<ImportStepper steps={steps} current={step} labels={STEP_LABELS} />
```
(`steps`, `step`, and `STEP_LABELS` already exist in scope.)

- [ ] **Step 3: Verify and visually check**

Run: `pnpm check` → green.
Visually at ~390px and desktop: walk account → choose → upload → review/preview → summary for both CSV and PDF and confirm the segmented bar advances and the step name/count is correct at each step.

- [ ] **Step 4: Commit**

```bash
git add src/app/import/ImportStepper.tsx src/app/import/ImportWizard.tsx
git commit -m "feat(import): segmented stepper replacing numbered step list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Choose-step cards + Back affordances

Give the `choose` step's CSV/PDF options the considered card treatment (icon tile, title, one honest line; CSV keeps "best for accuracy" copy, no loud badge), and add step-level **Back** so users aren't forced into destructive "Cancel import" to correct a wrong turn.

**Files:**
- Modify: `src/app/import/ImportWizard.tsx` (the `choose` section ~lines 291–341; the PDF `upload` branch ~lines 353–362; the `pdfReview` branch ~lines 410–428)
- Modify: `src/app/import/PdfUploadStep.tsx` (accept and render an `onBack` control)
- Modify: `src/app/import/PdfReviewStep.tsx` (add a non-destructive "Back" alongside "Cancel import")

**Interfaces:**
- `PdfUploadStep` gains an optional prop `onBack?: () => void`.
- `PdfReviewStep` gains an optional prop `onBack?: () => void` (re-upload); keeps `onCancelled`.

- [ ] **Step 1: Refine the choose-step cards**

In `ImportWizard.tsx`, within the `step === "choose"` section, keep the two `<button>` choice cards but align them to the mockup's structure — an icon tile, a title, and one honest sub-line. Concretely, replace each choice card's inner markup with this pattern (CSV shown; PDF mirrors it with the `FileText` icon and its copy, no "Recommended" badge):

```tsx
<button
  type="button"
  onClick={() => { setMode("csv"); setStep("upload"); }}
  className="flex flex-col gap-2 rounded-card border border-border-subtle bg-elevated p-4 text-left shadow-card transition-colors hover:border-border-strong"
>
  <span className="grid size-10 place-items-center rounded-xl border border-border-subtle bg-elevated-2 text-secondary">
    <FileSpreadsheet size={20} aria-hidden />
  </span>
  <span className="text-sm font-semibold text-primary">Upload CSV</span>
  <span className="text-sm text-secondary">Best for accurate, complete transaction history.</span>
</button>
```

- [ ] **Step 2: Add Back to the PDF upload step**

In `PdfUploadStep.tsx`, extend the props with `onBack?: () => void` and render a ghost Back control above or below the primary button:
```tsx
{onBack && (
  <button
    type="button"
    onClick={onBack}
    className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"
  >
    <ArrowLeft size={16} aria-hidden /> Back
  </button>
)}
```
Import `ArrowLeft` from `lucide-react` (alongside the existing `FileText`, `Upload`).

In `ImportWizard.tsx`, pass it when rendering the PDF upload branch:
```tsx
<PdfUploadStep
  accountId={accountId}
  accountName={selectedAccount?.displayName ?? ""}
  onBack={() => setStep("choose")}
  onReady={(review) => { setPdfReview(review); setStep("pdfReview"); }}
/>
```

- [ ] **Step 3: Add Back to the PDF review step**

In `PdfReviewStep.tsx`, extend props with `onBack?: () => void`. In the footer button row, add a ghost "Back" button before "Cancel import" that calls `onBack` (leaves the staged import intact for re-upload). Keep "Cancel import" (destructive, calls `cancelPdfImport`) and the primary "Confirm" button as-is:
```tsx
{onBack && (
  <button type="button" disabled={pending} onClick={onBack} className="rounded-xl border border-border-strong px-4 py-3 text-sm font-semibold text-primary disabled:opacity-60">
    Back
  </button>
)}
```
In `ImportWizard.tsx`, pass `onBack={() => { setPdfReview(null); setStep("upload"); }}` to `PdfReviewStep`.

- [ ] **Step 4: Verify and visually check**

Run: `pnpm check` → green.
Visually at ~390px: in the PDF branch, confirm Back moves upload → choose and review → upload without cancelling, and that Cancel import still discards. Confirm the choose cards render cleanly with no "Recommended" badge.

- [ ] **Step 5: Commit**

```bash
git add src/app/import/ImportWizard.tsx src/app/import/PdfUploadStep.tsx src/app/import/PdfReviewStep.tsx
git commit -m "feat(import): considered format cards + non-destructive Back affordances

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Empty-dashboard handoff + honest CTA labels

Turn the empty dashboard into an intentional post-onboarding handoff (a brief "you're set up" acknowledgment, one clear primary import path, demo profiles demoted to a secondary "Just exploring?" row), and fix the false `Import CSV` label on the accounts page.

**Files:**
- Modify: `src/components/dashboard/EmptyDashboard.tsx`
- Modify: `src/app/accounts/AccountsView.tsx` (the header import link, ~line 77)

**Interfaces:**
- No prop changes. `EmptyDashboard` keeps `{ companyName }`.

- [ ] **Step 1: Reshape the empty dashboard**

In `EmptyDashboard.tsx`, restructure so hierarchy reads as: (a) a compact "You're set up" acknowledgment card with a check icon; (b) the primary import card — icon tile + "Import your finances" + honest sub-copy "Bank CSV or a statement PDF. Everything is reviewed before it touches your record." + the emerald primary `Import financial data` link to `/import` + a muted helper "CSV is best for accuracy · PDF is a reviewed fallback"; (c) a divider; (d) the demo profiles under a `Just exploring?` label using the existing `DEMO_PROFILE_METAS.map(...)` + `LoadDemoButton`, visibly secondary. Keep the existing `Link`/`form action`/`LoadDemoButton` wiring; this is layout + copy + hierarchy, not new data flow. Follow the mockup (screen 01) and the token/emerald-once rule.

- [ ] **Step 2: Fix the accounts CTA label**

In `src/app/accounts/AccountsView.tsx`, change the header import link text from `Import CSV` to `Import` (leave the `Upload` icon and `href="/import"`):
```tsx
<Upload size={14} aria-hidden /> Import
```

- [ ] **Step 3: Verify and visually check**

Run: `pnpm check` → green.
Visually at ~390px and desktop: load a fresh/empty account state and confirm the handoff hierarchy (import primary, demo secondary) reads clearly; confirm the accounts header now says "Import".

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/EmptyDashboard.tsx src/app/accounts/AccountsView.tsx
git commit -m "feat(dashboard): intentional empty-state import handoff; honest 'Import' CTA

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Premium PDF upload screen + pre-upload guidance

Give `PdfUploadStep` a proper drop-target treatment with supported-format guidance up front, so wrong-type/too-big/password-protected failures are pre-empted rather than surfacing as bare errors.

**Files:**
- Modify: `src/app/import/PdfUploadStep.tsx`

**Interfaces:**
- No new props beyond `onBack` (Task 4). Keeps `accountId`, `accountName`, `onReady`.

- [ ] **Step 1: Rebuild the upload surface**

Keep the existing hidden `<input type="file">` + `submit()` + `uploadStatementPdf` logic and the `pending`/`error` state. Restyle the presentation to the mockup (screen 03): an "Importing into {accountName}" context chip; a dashed drop-target card (`rounded-card border border-border-strong bg-inset`) containing an emerald-muted upload icon tile, "Drop your statement here" / "or choose a file", the primary `Choose PDF file` button (keep the `pending` → "Uploading and extracting…" label + `aria-busy`), and a muted line "PDF up to 10 MB · checking, savings & credit-card statements" that states the real limits from `validatePdfUpload`. Keep the `role="status"` extracting message and the privacy note. Use `InlineError` (from Task 2) for `error`. Emerald appears once (the primary button).

- [ ] **Step 2: Verify and visually check**

Run: `pnpm check` → green.
Visually at ~390px and desktop: confirm the upload screen reads as a real drop zone with limits shown; upload a valid small PDF and confirm the extracting state; upload a non-PDF and confirm the `InlineError`.

- [ ] **Step 3: Commit**

```bash
git add src/app/import/PdfUploadStep.tsx
git commit -m "feat(import): premium PDF upload surface with supported-format guidance

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Review-screen redesign (card list, stat chips, duplicate toggle, dead-end fork)

The biggest visual change and the C-side of the duplicate bug. Rebuild `PdfReviewStep`'s presentation without changing its confirm/cancel logic, `duplicateByStagedId`/`accepted` computations, or the `confirmPdfImport` call.

**Files:**
- Modify: `src/app/import/PdfReviewStep.tsx`

**Interfaces:**
- Unchanged props/logic. Presentation only. `/ui-ux-pro-max` refines within the constraints.

- [ ] **Step 1: Replace the transaction table with a card list**

Replace the `<table className="min-w-[760px] ...">` block with a card containing one row per transaction (mockup screen 04). Each row: an include/exclude checkbox (bound to `updateRow(r.stagedId, { excluded: !r.excluded })`), left column with description + a line of `date (font-mono text-tertiary)` and a category chip, right column with the signed amount using `formatSignedDollars(r.direction === "inflow" ? r.amount : -r.amount)` in `font-mono tabular-nums` (emerald `text-positive` for inflow, `text-primary` for outflow) and a confidence chip. Confidence chips pair color with an icon/dot and text: `High` (neutral/positive), `Low` (warning with `AlertTriangle`) — never color-only. Preserve inline editability of date/description/amount/direction/category by keeping the existing controls inside each row (inline is fine at 390px per the spec default; keep the `updateRow` handlers).

- [ ] **Step 2: Rebuild duplicate handling as a calm strip + toggle**

For rows where `duplicateByStagedId.has(r.stagedId)`, render (in-row or directly under the row) a warning-muted strip "Looks already imported — excluded by default" with an explicit **Import anyway** toggle bound to the existing `setDuplicateImport(r.stagedId, checked)` / `importDuplicates` state. This replaces the bare `import duplicate` checkbox label. Icon + text; `bg-warning-muted`, `text-warning`.

- [ ] **Step 3: Promote summary + reconciliation to stat chips**

Replace the four `rounded-full border ...` count spans with a compact stat row (detected / possible duplicates / low confidence / parsing issues), each a small `bg-inset` chip with a mono value + uppercase micro-label, using the existing `rows.length`, `duplicateByStagedId.size`, `lowConfidence`, `issueCount`. Keep the reconciliation status (`reconText(review)`) and OCR/extraction notes; render reconciliation as a chip in the header card (`Reconciled` positive, `Does not reconcile` warning — paired with text). Keep the existing `unsupportedReason`/`failureReason`/OCR-warning/`validationResults` panels.

- [ ] **Step 4: Turn the blocked/unsupported state into a fork**

When `blocked` (`review.status === "unsupported" || "failed"`), instead of only a disabled Confirm + Cancel, render an actionable panel (mockup screen 05): a calm icon (shield/alert), the plain reason (`review.unsupportedReason ?? review.failureReason`), and two next steps — a primary "Import a CSV instead" and a ghost "Try a different PDF". Wire "Import a CSV instead" and "Try a different PDF" to `onCancelled` (which resets the wizard to the account step) — or, if `onBack` from Task 4 is present, "Try a different PDF" → `onBack`. Keep the normal (non-blocked) footer with Back / Cancel import / Confirm.

- [ ] **Step 5: Verify and visually check**

Run: `pnpm check` → green.
Visually at ~390px and desktop: import a native-text PDF and confirm the review list is legible (signed mono amounts, category + confidence chips, stat row, reconciliation chip); toggle a duplicate's "Import anyway" and confirm only that row flips; confirm an unsupported statement shows the fork with working "Import a CSV instead" / "Try a different PDF". Confirm the `Confirm N transactions` count still matches `accepted.length`.

- [ ] **Step 6: Manually verify the Task 1 bug fix end-to-end**

With a PDF whose staged rows include at least two that exact-duplicate existing transactions, accept "Import anyway" on exactly one; confirm the other duplicate is NOT imported (only the accepted one lands). This exercises the unique-`line` fix through the real confirm path.

- [ ] **Step 7: Commit**

```bash
git add src/app/import/PdfReviewStep.tsx
git commit -m "feat(import): rebuild PDF review as a legible card list with actionable dead-ends

Table -> card-per-transaction list (signed mono amounts, category + icon-paired
confidence chips), duplicate handling as a clear 'Import anyway' toggle, summary
stat chips, and unsupported statements offered a CSV/re-upload fork instead of a
disabled dead-end.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Documentation + final whole-slice verification

Record the (still-synchronous) PDF processing limitation and the doc-gap closure, note this slice in `CURRENT_PHASE.md`, and run a full green check.

**Files:**
- Modify: `docs/KNOWN_LIMITATIONS.md`
- Modify: `docs/CURRENT_PHASE.md`

- [ ] **Step 1: Record the deferred async rework as a known limitation**

Add a dated entry under an appropriate section of `docs/KNOWN_LIMITATIONS.md` (do not disturb the pre-existing uncommitted single-account-scoring edit): note that PDF statement import runs extraction + OCR (Tesseract, up to a 90s timeout) synchronously inside the `uploadStatementPdf` server action the client blocks on, that the DB already carries async statuses (`extracting`, `ocr_processing`) and a `getPdfImportReview` polling endpoint that nothing calls yet, and that moving to background processing + polling is the planned next slice (the real fix for perceived "hanging"). Also note that the PDF import feature (migrations `0013`/`0014`) landed on `main` outside the documented workflow and is being brought under docs as of this slice.

- [ ] **Step 2: Update CURRENT_PHASE.md**

Add this slice to `docs/CURRENT_PHASE.md` (In progress / Completed and Next-three-priorities as appropriate): "Import flow redesign — PDF `line` duplicate-integrity fix + premium UX pass (stepper, handoff, honest CTAs, Back affordances, InlineError, review card-list, dead-end fork)"; note the async PDF processing rework as the deferred follow-up.

- [ ] **Step 3: Final verification**

Run: `pnpm check`
Expected: lint 0 errors (1 pre-existing `AccountSheet.tsx` React Compiler warning is acceptable), typecheck clean, all vitest tests pass, build succeeds (routes unchanged).
Then a final visual pass of the entire flow (empty dashboard → import → CSV branch and PDF branch → summary) at ~390px and desktop.

- [ ] **Step 4: Commit**

```bash
git add docs/KNOWN_LIMITATIONS.md docs/CURRENT_PHASE.md
git commit -m "docs: record deferred async PDF processing; note import redesign slice

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** B fix → Task 1. C1 CTA labels → Task 5 (+ honest copy in Tasks 4/6). C2 onboarding handoff → Task 5. C3 in-wizard flow (stepper + Back) → Tasks 3, 4. C4 errors + dead-ends → Tasks 2, 7. C5 review polish → Task 7. Doc debt → Task 8. All spec sections map to a task.

**Placeholder scan:** No "TBD/TODO/handle edge cases". Logic code (Task 1, InlineError, stepper) is fully literal. UI-heavy tasks (5, 6, 7) give concrete structural JSX + exact class vocabulary + the existing handlers to preserve, gated on visual verification because the repo has no React unit-test harness (confirmed: vitest `environment: "node"`, no `@testing-library/react`) — `/ui-ux-pro-max` refines within stated token constraints. This is the honest gate for this repo, not a placeholder.

**Type consistency:** `mapStagedRowsToReviewTransactions` / `StagedTransactionRow` names match between Task 1's definition and its wiring. `line: idx + 2` satisfies `importRowSchema.line` (`>= 2`) and `confirmPdfImportSchema.rows.line` (`>= 1`). `onBack` prop added consistently to `PdfUploadStep`/`PdfReviewStep` in Task 4 and consumed in Task 7's fork. `formatSignedDollars` exists in `src/lib/financial-engine/format.ts`. `InlineError({ message })` signature consistent across Tasks 2, 6, 7.
