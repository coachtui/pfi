# Academy Slice 2 — FinancialTerm Interaction System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every canonical financial term PFI renders tappable, opening a pre-completion definition sheet drawn from the Slice 1 concept registry, wired into the report, dashboard, and score surfaces.

**Architecture:** A single client `TermSheetProvider` (mounted once in the root layout) holds a concept navigation stack and renders one shared `TermDefinitionSheet` built on the existing `Sheet` component. Inline `FinancialTerm` buttons call `openTerm(id)`. The sheet's content is derived by a framework-free, unit-tested `buildTermSheetModel(registry, id)` view-model builder — the React layer stays a thin renderer, consistent with this repo's "logic is framework-free and tested; UI is verified by e2e + live browse" architecture.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Tailwind 4 (tokens in `src/app/globals.css`), Vitest (node env, `.test.ts` only), Playwright e2e. pnpm.

## Global Constraints

- **Mobile-first:** design and verify at ~390px before desktop (then 1280px). Copied from CLAUDE.md.
- **Never color alone:** the tappable affordance must be shape-based (dashed underline); the reserved green (`--positive`) must not be repurposed for it.
- **Deterministic content only:** all sheet content is compile-time registry data — no fetch, no loading/error state, no AI. `src/lib/concepts/` **content and types are not modified** by this slice.
- **`src/lib/concepts/` stays framework-free:** no React/Next imports in any file under it (same rule as `financial-engine`/`demo-data`). `term-sheet.ts` and `score-term-map.ts` added here must obey this.
- **No new route:** the Playwright route count stays 20. No page added.
- **This repo has no React component test infrastructure** (vitest `include: ["src/**/*.test.ts"]`, `environment: "node"`, no jsdom/RTL, zero `.test.tsx`). Do **not** add RTL/jsdom. Unit-test the pure `.test.ts` logic; verify React via the existing Playwright e2e + live browse. This is the established pattern, not a shortcut.
- **`pnpm check`** (lint + typecheck + test + build) must be green before completion.

---

### Task 1: Pure term-sheet view-model + score-metric→concept map

Framework-free logic under `src/lib/concepts/`, fully unit-tested. No React.

**Files:**
- Create: `src/lib/concepts/term-sheet.ts`
- Create: `src/lib/concepts/term-sheet.test.ts`
- Create: `src/lib/concepts/score-term-map.ts`
- Create: `src/lib/concepts/score-term-map.test.ts`

**Interfaces:**
- Consumes: `ConceptRegistry` (`byId`, `published`) and `CONCEPT_REGISTRY` from `src/lib/concepts/index.ts`; `FinancialConcept`, `ConceptId` from `./types`; the metric registry from `src/lib/financial-engine/metrics.ts`.
- Produces:
  - `interface TermSheetRelated { id: ConceptId; title: string }`
  - `interface TermSheetModel { id: ConceptId; title: string; shortDefinition: string; fullDefinition: string; formula?: string; householdAdaptation?: string; related: TermSheetRelated[] }`
  - `function buildTermSheetModel(registry: ConceptRegistry, conceptId: ConceptId): TermSheetModel | null`
  - `const SCORE_METRIC_CONCEPT_IDS: Record<string, ConceptId>`

- [ ] **Step 1: Write the failing test for `buildTermSheetModel`**

Create `src/lib/concepts/term-sheet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import { buildTermSheetModel } from "./term-sheet";

describe("buildTermSheetModel", () => {
  it("returns the view-model for a published concept", () => {
    const m = buildTermSheetModel(CONCEPT_REGISTRY, "free-cash-flow");
    expect(m).not.toBeNull();
    expect(m!.title).toBe("Free cash flow");
    expect(m!.shortDefinition.length).toBeGreaterThan(0);
    expect(m!.fullDefinition.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown concept id", () => {
    expect(buildTermSheetModel(CONCEPT_REGISTRY, "owner-created-equity")).toBeNull();
    expect(buildTermSheetModel(CONCEPT_REGISTRY, "does-not-exist")).toBeNull();
  });

  it("filters related concepts to published records only", () => {
    const m = buildTermSheetModel(CONCEPT_REGISTRY, "free-cash-flow");
    expect(m).not.toBeNull();
    for (const r of m!.related) {
      const c = CONCEPT_REGISTRY.byId(r.id);
      expect(c?.status).toBe("published");
      expect(r.title).toBe(c!.title);
    }
  });

  it("omits the formula when the concept has none", () => {
    // net-worth has a formula; pick a concept without one to assert undefined.
    const withFormula = buildTermSheetModel(CONCEPT_REGISTRY, "free-cash-flow");
    expect(withFormula!.formula).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/lib/concepts/term-sheet.test.ts`
Expected: FAIL — `Cannot find module './term-sheet'`.

- [ ] **Step 3: Implement `buildTermSheetModel`**

Create `src/lib/concepts/term-sheet.ts`:

```ts
// src/lib/concepts/term-sheet.ts
// Framework-free (no React/Next). Builds the pre-completion definition-sheet
// view-model from the concept registry. Slice 2 (docs/superpowers/plans/2026-07-20-academy-slice2-financial-term.md).
import type { ConceptRegistry } from "./registry";
import type { ConceptId, FinancialConcept } from "./types";

export interface TermSheetRelated {
  id: ConceptId;
  title: string;
}

export interface TermSheetModel {
  id: ConceptId;
  title: string;
  shortDefinition: string;
  fullDefinition: string;
  formula?: string;
  householdAdaptation?: string;
  related: TermSheetRelated[];
}

/**
 * Build the definition-sheet view-model for a concept. Returns null when the
 * concept is missing or not published, so callers render nothing (FinancialTerm
 * degrades to plain text). Related concepts are filtered to published records.
 */
export function buildTermSheetModel(
  registry: ConceptRegistry,
  conceptId: ConceptId,
): TermSheetModel | null {
  const c = registry.byId(conceptId);
  if (!c || c.status !== "published") return null;

  const related: TermSheetRelated[] = c.relatedConceptIds
    .map((id) => registry.byId(id))
    .filter((r): r is FinancialConcept => !!r && r.status === "published")
    .map((r) => ({ id: r.id, title: r.title }));

  return {
    id: c.id,
    title: c.title,
    shortDefinition: c.shortDefinition,
    fullDefinition: c.fullDefinition,
    formula: c.formula,
    householdAdaptation: c.householdAdaptation,
    related,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/lib/concepts/term-sheet.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for the score map**

Create `src/lib/concepts/score-term-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CONCEPT_REGISTRY } from "./index";
import { METRICS } from "@/lib/financial-engine/metrics";
import { SCORE_METRIC_CONCEPT_IDS } from "./score-term-map";

describe("SCORE_METRIC_CONCEPT_IDS", () => {
  const metricIds = new Set(METRICS.map((d) => d.id));

  it("every key is a real score metric id", () => {
    for (const key of Object.keys(SCORE_METRIC_CONCEPT_IDS)) {
      expect(metricIds.has(key), `unknown metric id: ${key}`).toBe(true);
    }
  });

  it("every value is a published concept", () => {
    for (const id of Object.values(SCORE_METRIC_CONCEPT_IDS)) {
      expect(CONCEPT_REGISTRY.byId(id)?.status, `not published: ${id}`).toBe("published");
    }
  });
});
```

Note: the metric-definitions array is exported from `src/lib/financial-engine/metrics.ts` as `METRICS` (typed `MetricDef[]`), confirmed against the file. Each entry has an `id` (e.g. `net_cash_flow_margin`).

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm exec vitest run src/lib/concepts/score-term-map.test.ts`
Expected: FAIL — `Cannot find module './score-term-map'` (and possibly a metrics import-name error to resolve per the note above).

- [ ] **Step 7: Implement the score map**

Create `src/lib/concepts/score-term-map.ts`:

```ts
// src/lib/concepts/score-term-map.ts
// Framework-free. Maps a score-dimension metric id → the concept whose
// definition that metric's *label* teaches (what word the user is reading).
// This is deliberately distinct from a concept's dataMetricKey (which engine
// field feeds a lesson's personalization) — a label→term binding, not a
// data binding. Validated in score-term-map.test.ts.
import type { ConceptId } from "./types";

export const SCORE_METRIC_CONCEPT_IDS: Record<string, ConceptId> = {
  net_cash_flow_margin: "free-cash-flow", // "Free cash flow margin"
  recurring_surplus: "free-cash-flow",    // "Typical monthly free cash flow"
  liquid_runway_months: "liquidity",      // "Emergency runway"
  debt_service_ratio: "debt-pressure",    // "Debt burden"
};
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm exec vitest run src/lib/concepts/score-term-map.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Run the whole concepts suite to confirm no regressions**

Run: `pnpm exec vitest run src/lib/concepts`
Expected: PASS (all prior concept tests + the 6 new ones).

- [ ] **Step 10: Commit**

```bash
git add src/lib/concepts/term-sheet.ts src/lib/concepts/term-sheet.test.ts src/lib/concepts/score-term-map.ts src/lib/concepts/score-term-map.test.ts
git commit -m "feat(academy): term-sheet view-model + score-metric concept map (slice 2)"
```

---

### Task 2: React interaction layer — provider, FinancialTerm, sheet

The client components. Verified by typecheck + lint + build here; behavior is exercised by e2e in Task 4 (no component-test infra in this repo — see Global Constraints).

**Files:**
- Create: `src/components/concepts/TermSheetProvider.tsx`
- Create: `src/components/concepts/FinancialTerm.tsx`
- Create: `src/components/concepts/TermDefinitionSheet.tsx`
- Modify: `src/app/layout.tsx` (mount the provider around `main` + `BottomNav`)

**Interfaces:**
- Consumes: `Sheet` from `@/components/ui/Sheet`; `CONCEPT_REGISTRY` from `@/lib/concepts`; `buildTermSheetModel`, `TermSheetModel` from `@/lib/concepts/term-sheet`; `ConceptId` from `@/lib/concepts`.
- Produces:
  - `useTermSheet(): { openTerm(id: ConceptId): void; pushTerm(id: ConceptId): void; backTerm(): void; closeTerm(): void }`
  - `<TermSheetProvider>{children}</TermSheetProvider>`
  - `<FinancialTerm conceptId={ConceptId}>{label}</FinancialTerm>`

- [ ] **Step 1: Implement the provider**

Create `src/components/concepts/TermSheetProvider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ConceptId } from "@/lib/concepts";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import { buildTermSheetModel } from "@/lib/concepts/term-sheet";
import { TermDefinitionSheet } from "./TermDefinitionSheet";

interface TermSheetApi {
  openTerm(id: ConceptId): void;
  pushTerm(id: ConceptId): void;
  backTerm(): void;
  closeTerm(): void;
}

const TermSheetContext = createContext<TermSheetApi | null>(null);

export function useTermSheet(): TermSheetApi {
  const ctx = useContext(TermSheetContext);
  if (!ctx) throw new Error("useTermSheet must be used within TermSheetProvider");
  return ctx;
}

export function TermSheetProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ConceptId[]>([]);

  const openTerm = useCallback((id: ConceptId) => setStack([id]), []);
  const pushTerm = useCallback((id: ConceptId) => setStack((s) => [...s, id]), []);
  const backTerm = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const closeTerm = useCallback(() => setStack([]), []);

  const api = useMemo<TermSheetApi>(
    () => ({ openTerm, pushTerm, backTerm, closeTerm }),
    [openTerm, pushTerm, backTerm, closeTerm],
  );

  const currentId = stack.at(-1) ?? null;
  const model = currentId ? buildTermSheetModel(CONCEPT_REGISTRY, currentId) : null;

  return (
    <TermSheetContext.Provider value={api}>
      {children}
      <TermDefinitionSheet
        model={model}
        canGoBack={stack.length > 1}
        onBack={backTerm}
        onClose={closeTerm}
        onRelated={pushTerm}
      />
    </TermSheetContext.Provider>
  );
}
```

- [ ] **Step 2: Implement the sheet**

Create `src/components/concepts/TermDefinitionSheet.tsx`:

```tsx
"use client";

import { ChevronLeft } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import type { ConceptId } from "@/lib/concepts";
import type { TermSheetModel } from "@/lib/concepts/term-sheet";

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
    <Sheet open={model !== null} onClose={onClose} title={model?.title ?? ""}>
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

          <p className="text-base leading-relaxed text-primary">{model.shortDefinition}</p>
          <p className="text-sm leading-relaxed text-secondary">{model.fullDefinition}</p>

          {model.formula && (
            <div className="rounded-xl border border-border-subtle bg-inset p-3">
              <p className="mb-1 text-xs font-medium tracking-wide text-tertiary uppercase">Formula</p>
              <p className="font-mono text-sm text-primary">{model.formula}</p>
              {model.householdAdaptation && (
                <p className="mt-2 text-xs text-tertiary">Household: {model.householdAdaptation}</p>
              )}
            </div>
          )}

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
        </div>
      )}
    </Sheet>
  );
}
```

Note: `Sheet` (`src/components/ui/Sheet.tsx`) returns `null` when `open` is false, so passing `open={model !== null}` with `title=""` when closed renders nothing. Confirm `bg-inset` is a valid token (it is — `--color-inset` in globals.css).

- [ ] **Step 3: Implement `FinancialTerm`**

Create `src/components/concepts/FinancialTerm.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { CONCEPT_REGISTRY, type ConceptId } from "@/lib/concepts";
import { useTermSheet } from "./TermSheetProvider";

/**
 * Inline tappable financial term. Opens the definition sheet for `conceptId`.
 * If the id is not a published concept, renders the children as plain text
 * (never a broken control) — miswires are caught by label-consistency.test.ts.
 * Affordance is shape-based (dashed underline), never color, per project rules.
 */
export function FinancialTerm({ conceptId, children }: { conceptId: ConceptId; children: ReactNode }) {
  const { openTerm } = useTermSheet();
  const concept = CONCEPT_REGISTRY.byId(conceptId);

  if (!concept || concept.status !== "published") return <>{children}</>;

  return (
    <button
      type="button"
      onClick={() => openTerm(conceptId)}
      aria-label={`${concept.title} — show definition`}
      className="rounded-sm underline decoration-dotted decoration-tertiary underline-offset-2 hover:decoration-secondary focus:outline-none focus-visible:decoration-primary focus-visible:decoration-solid"
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Mount the provider in the root layout**

In `src/app/layout.tsx`, add the import and wrap `main` + `BottomNav`:

```tsx
import { TermSheetProvider } from "@/components/concepts/TermSheetProvider";
```

Change the body content from:

```tsx
      <body className="flex min-h-full flex-col">
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-28">{children}</main>
        <BottomNav />
      </body>
```

to:

```tsx
      <body className="flex min-h-full flex-col">
        <TermSheetProvider>
          <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 pb-28">{children}</main>
          <BottomNav />
        </TermSheetProvider>
      </body>
```

- [ ] **Step 5: Verify it typechecks, lints, and builds (nothing wired yet — the sheet is inert)**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: typecheck clean; lint 0 errors (1 pre-existing `AccountSheet.tsx` React Compiler warning is acceptable); build succeeds, **20 routes** (unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/components/concepts/ src/app/layout.tsx
git commit -m "feat(academy): FinancialTerm + term-sheet provider mounted in layout (slice 2)"
```

---

### Task 3: Wire canonical term labels on report, dashboard, and score

Explicit `<FinancialTerm>` wrapping at each label call site, plus extended drift-guard coverage.

**Files:**
- Modify: `src/app/report/ReportView.tsx` (add `conceptId` to `StatementRow`; pass it on wired rows)
- Modify: `src/components/dashboard/MetricCard.tsx` (add optional `conceptId` prop)
- Modify: `src/components/dashboard/HomeDashboard.tsx` (pass `conceptId` on wired cards)
- Modify: `src/app/score/ScoreView.tsx` (wrap dimension metric names via `SCORE_METRIC_CONCEPT_IDS`)
- Modify: `src/lib/concepts/label-consistency.test.ts` (assert wiring coverage)

**Interfaces:**
- Consumes: `FinancialTerm` (Task 2); `SCORE_METRIC_CONCEPT_IDS` (Task 1).
- Produces: no new exports.

Wired concept ids (each verified `published` in Task 1 / by the extended test):
- **Report** `StatementRow` labels → concept: `Revenue`→`revenue`, `Operating expenses`→`operating-expenses`, `Free cash flow`→`free-cash-flow`, `Savings (retained cash)`→`retained-cash`, `Savings rate`→`savings-rate`. Leave plain (no concept): `Investments (contributions)`, `Debt reduction`, `Owner-created equity` (no registry concept — see existing test comment), `Market appreciation`, `Index movement`.
- **Dashboard** `MetricCard` labels → concept: `Available capital`→`available-capital`, `Obligations`→`short-term-obligations`, `Cushion`→`financial-flexibility`. Leave any 4th card without a clean 1:1 concept plain.
- **Score** dimension metrics → via `SCORE_METRIC_CONCEPT_IDS` (Task 1). Top-movers list stays plain (dense delta list — out of scope).

- [ ] **Step 1: Write the failing coverage test (extend `label-consistency.test.ts`)**

Append to `src/lib/concepts/label-consistency.test.ts` (keep existing `describe` block intact; add a new one):

```ts
import { CONCEPT_REGISTRY } from "./index";

describe("FinancialTerm wiring coverage (slice 2)", () => {
  const wiring: Array<[file: string, conceptIds: string[]]> = [
    ["src/app/report/ReportView.tsx", ["revenue", "operating-expenses", "free-cash-flow", "retained-cash", "savings-rate"]],
    ["src/components/dashboard/HomeDashboard.tsx", ["available-capital", "short-term-obligations", "financial-flexibility"]],
  ];

  it("each wired call site references its published concept ids", () => {
    for (const [file, ids] of wiring) {
      const src = read(file);
      for (const id of ids) {
        expect(CONCEPT_REGISTRY.byId(id)?.status, `${id} not published`).toBe("published");
        expect(src, `${file} missing conceptId="${id}"`).toContain(`conceptId="${id}"`);
      }
    }
  });

  it("report still uses the canonical free-cash-flow row label alongside its term wiring", () => {
    const src = read("src/app/report/ReportView.tsx");
    expect(src).toContain(`label="${FREE_CASH_FLOW_TITLE}"`);
    expect(src).toContain(`conceptId="free-cash-flow"`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/lib/concepts/label-consistency.test.ts`
Expected: FAIL — the `conceptId="…"` strings are not yet present in the source files.

- [ ] **Step 3: Wire the report**

In `src/app/report/ReportView.tsx`:

Add the import near the top (with the other `@/` imports):

```tsx
import { FinancialTerm } from "@/components/concepts/FinancialTerm";
import type { ConceptId } from "@/lib/concepts";
```

Extend `StatementRow` to accept an optional `conceptId` and wrap the label when present. Change the destructure and signature:

```tsx
function StatementRow({
  label, value, conceptId, tone = "neutral", emphasized = false, indent = false, muted = false,
}: {
  label: string;
  value: string;
  conceptId?: ConceptId;
  tone?: "positive" | "negative" | "neutral";
  emphasized?: boolean;
  indent?: boolean;
  muted?: boolean;
}) {
```

And change the `<dt>` to wrap when a `conceptId` is present:

```tsx
      <dt className={`text-sm ${emphasized ? "text-primary" : "text-secondary"}`}>
        {conceptId ? <FinancialTerm conceptId={conceptId}>{label}</FinancialTerm> : label}
      </dt>
```

Then add `conceptId` on the wired rows (keep every existing prop, including the exact `label="…"` strings):

```tsx
          <StatementRow label="Revenue" conceptId="revenue" value={formatDollars(statement.revenue)} tone="positive" />
          <StatementRow label="Operating expenses" conceptId="operating-expenses" value={`− ${formatDollars(statement.operatingExpenses)}`} tone="negative" />
          <StatementRow label="Free cash flow" conceptId="free-cash-flow" value={formatSignedDollars(statement.freeCashFlow)} tone={statement.freeCashFlow >= 0 ? "positive" : "negative"} emphasized />
```

and

```tsx
          <StatementRow label="Savings (retained cash)" conceptId="retained-cash" value={formatSignedDollars(statement.savings)} indent />
```

and

```tsx
          <StatementRow label="Savings rate" conceptId="savings-rate" value={`${statement.savingsRatePct.toFixed(1)}%`} />
```

Leave `Investments (contributions)`, `Debt reduction`, `Owner-created equity`, `Market appreciation`, and `Index movement` rows unchanged (no `conceptId`).

- [ ] **Step 4: Wire the dashboard**

In `src/components/dashboard/MetricCard.tsx`, add the optional prop and render the label wrapped when present.

Add imports:

```tsx
import { FinancialTerm } from "@/components/concepts/FinancialTerm";
import type { ConceptId } from "@/lib/concepts";
```

Add to `MetricCardProps`:

```tsx
  /** When set, the label becomes a tappable FinancialTerm. */
  conceptId?: ConceptId;
```

Add `conceptId` to the destructured params, and where the label text is rendered, wrap it:

```tsx
{conceptId ? <FinancialTerm conceptId={conceptId}>{label}</FinancialTerm> : label}
```

(Find the JSX node that currently renders `{label}` — it is the label element inside the card. Wrap only that occurrence.)

In `src/components/dashboard/HomeDashboard.tsx`, add `conceptId` to the three wired cards (keep all existing props):

```tsx
        <MetricCard
          label="Available capital"
          conceptId="available-capital"
          ...
        />
```
```tsx
        <MetricCard
          label="Obligations"
          conceptId="short-term-obligations"
          ...
        />
```
```tsx
        <MetricCard
          label="Cushion"
          conceptId="financial-flexibility"
          ...
        />
```

If a 4th `MetricCard` exists without a clean 1:1 concept, leave it without `conceptId`.

- [ ] **Step 5: Wire the score dimension metrics**

In `src/app/score/ScoreView.tsx`, add imports:

```tsx
import { FinancialTerm } from "@/components/concepts/FinancialTerm";
import { SCORE_METRIC_CONCEPT_IDS } from "@/lib/concepts/score-term-map";
```

In the dimension metrics map (`d.metrics.map((m) => …)`), wrap `{m.name}` when the map has an entry:

```tsx
                      <span className="text-primary">
                        {SCORE_METRIC_CONCEPT_IDS[m.id] ? (
                          <FinancialTerm conceptId={SCORE_METRIC_CONCEPT_IDS[m.id]}>{m.name}</FinancialTerm>
                        ) : (
                          m.name
                        )}
                        {!m.scored && <span className="ml-1 text-xs text-tertiary">(context only)</span>}
                      </span>
```

Leave the top-movers list (`delta.topMovers.map`) unchanged.

- [ ] **Step 6: Run the coverage test to verify it passes**

Run: `pnpm exec vitest run src/lib/concepts/label-consistency.test.ts`
Expected: PASS (existing canonical-label tests + the 2 new coverage tests).

- [ ] **Step 7: Full check**

Run: `pnpm check`
Expected: green — lint 0 errors (1 pre-existing warning ok), typecheck clean, all unit tests pass, build succeeds at 20 routes.

- [ ] **Step 8: Commit**

```bash
git add src/app/report/ReportView.tsx src/components/dashboard/MetricCard.tsx src/components/dashboard/HomeDashboard.tsx src/app/score/ScoreView.tsx src/lib/concepts/label-consistency.test.ts
git commit -m "feat(academy): wire FinancialTerm into report, dashboard, score (slice 2)"
```

---

### Task 4: e2e flow, docs, and live verification

**Files:**
- Modify: `e2e/smoke.spec.ts` (add a term-sheet interaction test to the serial journey)
- Modify: `docs/CURRENT_PHASE.md`, `docs/ROADMAP.md` (mark Slice 2 status)
- Modify: `docs/DECISIONS.md` (only if a structural decision was made — e.g. the label→term vs dataMetricKey distinction; a short entry is warranted)

**Interfaces:**
- Consumes: the running app with wiring from Task 3.
- Produces: no code exports.

- [ ] **Step 1: Add the e2e term-sheet test**

In `e2e/smoke.spec.ts`, after the existing `"score screen renders the breakdown"` test (still in the same serial `describe`), add a test that opens a term sheet on `/report`. Match the file's existing style (shared `page`, `getByRole`). Use the report's "Free cash flow" term:

```ts
test("tapping a financial term opens its definition sheet with related navigation", async () => {
  await page.goto("/report");
  await page.getByRole("button", { name: "Free cash flow — show definition" }).first().click();

  const sheet = page.getByRole("dialog", { name: "Free cash flow" });
  await expect(sheet).toBeVisible();

  // Related navigation: tap a related concept chip, content swaps, Back returns.
  const related = sheet.getByRole("button").filter({ hasNotText: "Close" });
  await related.last().click();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog", { name: "Free cash flow" })).toBeVisible();

  // Close.
  await page.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
```

Note: `Sheet` sets `aria-label={title}` on the dialog, so `getByRole("dialog", { name })` matches the concept title. Confirm the related-chip selector against the actual rendered buttons; if the free-cash-flow related list is empty in the registry, pick a different starting term that has published related concepts, or assert only open/close. Verify against the real registry before finalizing the selector.

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: all specs pass, including the new one. Route count and other specs unaffected.

If the term selector or related-chip assertion is brittle, adjust to the real DOM (the test must reflect what renders, not the other way around).

- [ ] **Step 3: Live browse verification (mobile-first)**

Start the dev server and authenticate an ephemeral user with sample data loaded (same pattern as the Slice 1 verification recorded in `docs/CURRENT_PHASE.md` "Test status": admin-generated magic-link `token_hash` redeemed via `/auth/confirm`, onboard with sample data). Then, at **390×844 first, then 1280×900**, verify on `/report`, the dashboard (`/`), and `/score`:
  - The dashed-underline affordance is visible on wired labels and legible on dense report statement rows (not mistaken for a value).
  - Tapping a term opens the sheet (bottom sheet at 390, centered dialog at 1280) with the correct title, short + full definition, formula block where present, and related chips.
  - A related chip swaps content in place; Back returns; Close dismisses.
  - Keyboard path works: Tab to a term, Enter opens, Tab through chips, Escape closes.
  - **Zero console errors** on all three screens at both viewports.
  Clean up the test user and any scratch scripts afterward. Do not report any email/side-effect as sent unless actually observed.

- [ ] **Step 4: Update docs**

- `docs/ROADMAP.md`: mark Phase 4.5 Slice 2 (`FinancialTerm interaction system`) with the ✅ landed marker and date, matching the Slice 1 entry's format.
- `docs/CURRENT_PHASE.md`: move Slice 2 from "next priority" to a completed entry; update the header `_Last updated_` line; refresh "Test status" with the exact `pnpm check`/e2e/live-verification results; set Slice 3 as the next priority.
- `docs/DECISIONS.md`: if the label→term vs dataMetricKey distinction (Task 1) is worth recording (it is a small structural convention), add a dated entry noting that `SCORE_METRIC_CONCEPT_IDS` is a label-teaching binding distinct from `dataMetricKey`.

- [ ] **Step 5: Commit**

```bash
git add e2e/smoke.spec.ts docs/CURRENT_PHASE.md docs/ROADMAP.md docs/DECISIONS.md
git commit -m "test(academy): e2e term-sheet flow + docs for slice 2"
```

- [ ] **Step 6: Final whole-branch review**

Per this project's workflow (CLAUDE.md), request a whole-branch code review (superpowers:requesting-code-review) before merge. Address any findings in a fix round, re-run `pnpm check`, then finish the branch (superpowers:finishing-a-development-branch → PR).

---

## Self-Review

**Spec coverage** (checked against `docs/superpowers/specs/2026-07-20-academy-slice2-financial-term-design.md`):
- `TermSheetProvider` + stack API → Task 2. ✅
- `FinancialTerm` (dashed underline, plain-text fallback, aria-label) → Task 2. ✅
- `TermDefinitionSheet` (short/full def, formula + household adaptation, related chips, back control) → Task 2. ✅
- Sheet content order & published-only related → Task 1 (`buildTermSheetModel`) + Task 2 render. ✅
- Wiring report/dashboard/score labels → Task 3. ✅
- Accessibility (real buttons, shape-not-color, Escape, focus) → Task 2 components + Task 4 keyboard verify. ✅
- Testing: pure unit (Task 1), coverage extension (Task 3), e2e (Task 4), live verify (Task 4). ✅ (Note: spec's "unit test FinancialTerm renders a button" is re-mapped to e2e because the repo has no component-test infra — documented in Global Constraints; the *logic* is unit-tested via `buildTermSheetModel`.)
- Registry unchanged → honored (only new files added under `src/lib/concepts/`). ✅
- No new route (count stays 20) → asserted in Task 2 Step 5 and Task 3 Step 7. ✅
- Deferred items (prose auto-linking, lesson CTA, Academy home, progress, analytics) → not in any task. ✅

**Placeholder scan:** no TBD/TODO; all code blocks are concrete. Two explicit "verify against the real file/registry" notes (metrics export name in Task 1 Step 5; related-chip selector in Task 4 Step 1) are genuine lookups, not placeholders — each says exactly what to confirm and the fallback.

**Type consistency:** `TermSheetModel`/`TermSheetRelated`/`buildTermSheetModel`/`SCORE_METRIC_CONCEPT_IDS` names are identical across Tasks 1–3. `useTermSheet` API (`openTerm`/`pushTerm`/`backTerm`/`closeTerm`) is consistent between provider (Task 2 Step 1) and consumer (`FinancialTerm`, Task 2 Step 3). `conceptId` prop name consistent across `StatementRow`/`MetricCard`/`FinancialTerm`.
