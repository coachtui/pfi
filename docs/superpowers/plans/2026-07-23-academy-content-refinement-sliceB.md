# Academy Content-Refinement Slice B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the 9 remaining Academy lessons to the refined content pattern (Revenue reference), and extend the `concept-live` resolver so `metric:`/`snapshot:`-bound lessons render live household data.

**Architecture:** Two parts. (1) A bounded engine extension: `src/lib/data/concept-live.ts` gains pure `computeMetricLive`/`computeSnapshotLive` resolvers alongside `computeReportLive`, a pure dispatcher, and a widened async fetch wrapper that loads accounts (via the existing `fetchScoreSources`) for the `metric:` path. (2) Pure content authoring: each of 9 lesson content files gains `plainEnglishSummary`, `memorableDistinction`, `formulaRows`, `comparisonRows`, `interpretation`, concept-level `whereUsed`, and `completionSummary`, following `src/lib/concepts/content/revenue.ts` exactly. No schema, component, registry, route, nav, or progress-model changes.

**Tech Stack:** TypeScript (strict), Vitest, Next.js 16 App Router, Supabase, framework-free `src/lib/financial-engine` and `src/lib/concepts`.

## Global Constraints

- **`src/lib/financial-engine` and `src/lib/concepts` stay framework-free** — no React/Next imports. `concept-live.ts` keeps its pure/impure split: pure resolvers are unit-testable; the `server-only` `./queries` import stays a dynamic import inside the async wrapper only.
- **Resolver framing is value-neutral** — emit only current value / prior value / signed delta. Never encode good/bad. Load-bearing for `debt_service_ratio` and `operating-expenses`, where **lower is better**.
- **Never "higher is always good"** in any `interpretation` field — direction-of-good stated in plain words, no verdict/blame language.
- **No color-alone state** — comparison rows carry check/✗ **and** text.
- **Sample figures labeled as sample** — every `lesson.genericExample` must contain the word "sample" (enforced by `content.test.ts`); `formulaRows` with `staticValue` render under a "Sample figures" pill by the existing `FormulaBlock`.
- **No internal engineering language** in any content string — `content.test.ts` bans `/audit ruling/i`, `/spec finding/i`, `/\btask \d/i`, `/decisions #/i`, `/implementation plan/i`.
- **Keep owner-created equity distinct from market appreciation** wherever investment/net-worth value appears (binding product rule).
- **Mobile-first** — verify at ~390px before desktop.
- `pnpm check` (lint + typecheck + test + build) must be green before completion.
- Commit message trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Part 1 — Resolver extension

### Task 1: `computeMetricLive` — pure resolver for the `metric:` namespace

**Files:**
- Modify: `src/lib/data/concept-live.ts`
- Test: `src/lib/data/concept-live.test.ts`

**Interfaces:**
- Consumes: `buildMetricInputs`, `computeMetrics`, `METRICS`, `enumeratePeriods`, `latestCompletePeriod`, `type DailySnapshot`, `type ScoreTransactionInput`, `type ScoreAccountInput`, `type ReportPeriod`, `type MetricResult` — all from `@/lib/financial-engine`. `ConceptLiveData` (existing, this file).
- Produces: `export function computeMetricLive(metricKey: string, snapshots: DailySnapshot[], transactions: ScoreTransactionInput[], accounts: ScoreAccountInput[]): ConceptLiveData | null`

Notes for the implementer:
- `MetricResult` already carries `value: number | null`, `formatted: string | null`, and `availability`. Use `formatted` for the displayed value; look up the metric's `format` fn in `METRICS` to format the **delta magnitude**.
- Derive current/prior period ends the same way `computeReportLive` does: `enumeratePeriods(snapshots, "monthly")` → `latestCompletePeriod(...)` for current, the period immediately before it for prior. `asOf` for a metric read is that period's `end` date.
- Only support the three real Slice B metric ids; unknown id, non-`metric:` namespace, `availability !== "available"`, `value === null`, or empty snapshots → `null`. Missing prior → non-null with `deltaDisplay: null` (mirror `computeReportLive`).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/data/concept-live.test.ts` (extend the existing `snap`/`SNAPSHOTS` helpers; add typed builders for score-shaped transactions/accounts):

```ts
import { computeMetricLive } from "./concept-live";
import type { ScoreTransactionInput, ScoreAccountInput } from "@/lib/financial-engine";

// liquid_runway_months → "N.N mo"; recurring_surplus → "$N"; debt_service_ratio → "NN%".
const scoreTxn = (postedDate: string, amount: number, direction: "inflow" | "outflow", category: string): ScoreTransactionInput =>
  ({ postedDate, amount, direction, category, isTransfer: false, description: category }) as ScoreTransactionInput;

describe("computeMetricLive", () => {
  it("returns null for a non-metric namespace", () => {
    expect(computeMetricLive("report:revenue", SNAPSHOTS, [], [])).toBeNull();
  });

  it("returns null for an unknown metric id", () => {
    expect(computeMetricLive("metric:not_a_metric", SNAPSHOTS, [], [])).toBeNull();
  });

  it("returns null when the metric is unavailable (no income)", () => {
    // liquid_runway_months is unavailable with no essential spend / income context.
    expect(computeMetricLive("metric:liquid_runway_months", [], [], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/data/concept-live.test.ts`
Expected: FAIL — `computeMetricLive` not exported.

- [ ] **Step 3: Implement `computeMetricLive`**

Add to `src/lib/data/concept-live.ts` (extend the top import from `@/lib/financial-engine` to include `buildMetricInputs, computeMetrics, METRICS, enumeratePeriods, latestCompletePeriod` and the `ScoreTransactionInput, ScoreAccountInput, ReportPeriod` types):

```ts
/** Current + prior complete monthly period ends, or null when unavailable. */
function currentAndPriorPeriods(snapshots: DailySnapshot[]): { current: ReportPeriod; prior: ReportPeriod | null } | null {
  if (snapshots.length === 0) return null;
  const periods = enumeratePeriods(snapshots, "monthly");
  const current = latestCompletePeriod(periods);
  if (!current) return null;
  const idx = periods.findIndex((p) => p.key === current.key);
  return { current, prior: idx > 0 ? periods[idx - 1]! : null };
}

const METRIC_IDS = ["recurring_surplus", "liquid_runway_months", "debt_service_ratio"] as const;

export function computeMetricLive(
  metricKey: string,
  snapshots: DailySnapshot[],
  transactions: ScoreTransactionInput[],
  accounts: ScoreAccountInput[],
): ConceptLiveData | null {
  const [ns, id] = metricKey.split(":");
  if (ns !== "metric" || !METRIC_IDS.includes(id as (typeof METRIC_IDS)[number])) return null;
  const def = METRICS.find((m) => m.id === id);
  if (!def) return null;

  const bounds = currentAndPriorPeriods(snapshots);
  if (!bounds) return null;

  const resultAt = (asOf: string): { value: number; formatted: string } | null => {
    const results = computeMetrics(buildMetricInputs(snapshots, transactions, accounts, asOf));
    const r = results.find((m) => m.id === id);
    if (!r || r.availability !== "available" || r.value === null || r.formatted === null) return null;
    return { value: r.value, formatted: r.formatted };
  };

  const current = resultAt(bounds.current.end);
  if (!current) return null;
  const prior = bounds.prior ? resultAt(bounds.prior.end) : null;

  let deltaDisplay: string | null = null;
  if (prior && bounds.prior) {
    const delta = current.value - prior.value;
    deltaDisplay = `${delta >= 0 ? "+" : "−"}${def.format(Math.abs(delta))} vs ${bounds.prior.label}`;
  }

  return {
    periodLabel: bounds.current.label,
    display: current.formatted,
    priorLabel: bounds.prior?.label ?? null,
    priorDisplay: prior?.formatted ?? null,
    deltaDisplay,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/data/concept-live.test.ts`
Expected: PASS (all three `computeMetricLive` cases, plus the pre-existing `computeReportLive` cases still passing unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/concept-live.ts src/lib/data/concept-live.test.ts
git commit -m "feat(academy): concept-live resolver for the metric: namespace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `computeSnapshotLive` — pure resolver for the `snapshot:` namespace

**Files:**
- Modify: `src/lib/data/concept-live.ts`
- Test: `src/lib/data/concept-live.test.ts`

**Interfaces:**
- Consumes: `formatDollars`, `type DailySnapshot` (`@/lib/financial-engine`); `currentAndPriorPeriods` (Task 1, same file); `ConceptLiveData`.
- Produces: `export function computeSnapshotLive(metricKey: string, snapshots: DailySnapshot[]): ConceptLiveData | null`

Notes: only `snapshot:netWorth` is supported this slice. Current value = the last snapshot dated `<= current period end`'s `netWorth`; prior = last snapshot `<= prior period end`. `formatDollars` is already imported at the top of the file.

- [ ] **Step 1: Write the failing tests**

Update this test file's existing top import line to add `computeSnapshotLive` alongside `computeMetricLive` and `computeReportLive` (from `./concept-live`), then add:

```ts
const snapNet = (date: string, netWorth: number): DailySnapshot =>
  ({ date, liquidAssets: 0, revolvingBalances: 0, nearTermObligations: 0, netWorth }) as DailySnapshot;

describe("computeSnapshotLive", () => {
  it("resolves current and prior net worth for snapshot:netWorth", () => {
    const snaps = [
      snapNet("2026-04-30", 100000),
      snapNet("2026-05-31", 108000),
      snapNet("2026-06-30", 112000),
    ];
    const live = computeSnapshotLive("snapshot:netWorth", snaps);
    expect(live).not.toBeNull();
    expect(live!.display).toMatch(/112,?000/);
    expect(live!.priorDisplay).toMatch(/108,?000/);
    expect(live!.deltaDisplay).toMatch(/^\+/);
    expect(live!.deltaDisplay).toContain("vs");
  });

  it("returns null for the wrong namespace/field and for empty snapshots", () => {
    expect(computeSnapshotLive("snapshot:liquidAssets", [snapNet("2026-06-30", 1)])).toBeNull();
    expect(computeSnapshotLive("snapshot:netWorth", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/data/concept-live.test.ts`
Expected: FAIL — `computeSnapshotLive` not exported.

- [ ] **Step 3: Implement `computeSnapshotLive`**

```ts
export function computeSnapshotLive(metricKey: string, snapshots: DailySnapshot[]): ConceptLiveData | null {
  const [ns, field] = metricKey.split(":");
  if (ns !== "snapshot" || field !== "netWorth") return null;

  const bounds = currentAndPriorPeriods(snapshots);
  if (!bounds) return null;

  const netWorthAt = (endDate: string): number | null => {
    const upto = snapshots.filter((s) => s.date <= endDate);
    const last = upto.at(-1);
    return last ? last.netWorth : null;
  };

  const current = netWorthAt(bounds.current.end);
  if (current === null) return null;
  const prior = bounds.prior ? netWorthAt(bounds.prior.end) : null;

  let deltaDisplay: string | null = null;
  if (prior !== null && bounds.prior) {
    const delta = current - prior;
    deltaDisplay = `${delta >= 0 ? "+" : "−"}${formatDollars(Math.abs(delta))} vs ${bounds.prior.label}`;
  }

  return {
    periodLabel: bounds.current.label,
    display: formatDollars(current),
    priorLabel: bounds.prior?.label ?? null,
    priorDisplay: prior !== null ? formatDollars(prior) : null,
    deltaDisplay,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/data/concept-live.test.ts`
Expected: PASS (all report/metric/snapshot cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/concept-live.ts src/lib/data/concept-live.test.ts
git commit -m "feat(academy): concept-live resolver for the snapshot: namespace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Dispatcher + widened fetch wrapper

**Files:**
- Modify: `src/lib/data/concept-live.ts`
- Modify: `src/lib/data/queries.ts` (export `fetchScoreSources` + `ScoreSourceRows`)
- Test: `src/lib/data/concept-live.test.ts`

**Interfaces:**
- Consumes: `computeReportLive`, `computeMetricLive`, `computeSnapshotLive` (same file); `fetchScoreSources`, `getReportData` (`./queries`, dynamic import).
- Produces:
  - `export function computeConceptLive(metricKey: string, data: { snapshots: DailySnapshot[]; transactions: ScoreTransactionInput[]; accounts: ScoreAccountInput[]; events: FinancialEvent[] }): ConceptLiveData | null` — pure dispatcher.
  - `getConceptLiveData(supabase, metricKey)` — unchanged signature, now handles all three namespaces.

- [ ] **Step 1: Write the failing test for the pure dispatcher**

Add `computeConceptLive` to this test file's existing top import line (from `./concept-live`), reusing the `snapNet` helper already defined earlier in the file (Task 2), then add:

```ts
describe("computeConceptLive (dispatch)", () => {
  it("routes each namespace to its resolver and returns null for unknown", () => {
    const snaps = [snapNet("2026-04-30", 100000), snapNet("2026-05-31", 108000), snapNet("2026-06-30", 112000)];
    const data = { snapshots: snaps, transactions: [] as ScoreTransactionInput[], accounts: [] as ScoreAccountInput[], events: [] };
    expect(computeConceptLive("snapshot:netWorth", data)).not.toBeNull();          // → computeSnapshotLive
    expect(computeConceptLive("metric:not_a_metric", data)).toBeNull();            // → computeMetricLive (unknown id)
    expect(computeConceptLive("position:availablePosition", data)).toBeNull();     // unsupported namespace
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/data/concept-live.test.ts`
Expected: FAIL — `computeConceptLive` not exported.

- [ ] **Step 3: Export `fetchScoreSources` and `ScoreSourceRows` from `queries.ts`**

In `src/lib/data/queries.ts`, add `export` to the existing declarations (around lines 196 and 203):

```ts
export interface ScoreSourceRows {
  snapshots: DailySnapshot[];
  transactions: ScoreTransactionInput[];
  accounts: ScoreAccountInput[];
  events: FinancialEvent[];
}

export async function fetchScoreSources(supabase: SupabaseClient): Promise<ScoreSourceRows> {
```

(No body change — only the `export` keyword added to both.)

- [ ] **Step 4: Implement dispatcher + widened wrapper in `concept-live.ts`**

Add the pure dispatcher and rewrite `getConceptLiveData`:

```ts
export function computeConceptLive(
  metricKey: string,
  data: { snapshots: DailySnapshot[]; transactions: ScoreTransactionInput[]; accounts: ScoreAccountInput[]; events: FinancialEvent[] },
): ConceptLiveData | null {
  const ns = metricKey.split(":")[0];
  if (ns === "report") return computeReportLive(metricKey, data.snapshots, data.transactions, data.events);
  if (ns === "metric") return computeMetricLive(metricKey, data.snapshots, data.transactions, data.accounts);
  if (ns === "snapshot") return computeSnapshotLive(metricKey, data.snapshots);
  return null; // position: and any future namespace — not supported this slice
}

export async function getConceptLiveData(
  supabase: SupabaseClient,
  metricKey: string,
): Promise<ConceptLiveData | null> {
  const ns = metricKey.split(":")[0];
  const { getReportData, fetchScoreSources } = await import("./queries");
  if (ns === "report") {
    const { snapshots, transactions, events } = await getReportData(supabase);
    return computeConceptLive(metricKey, { snapshots, transactions, accounts: [], events });
  }
  if (ns === "metric" || ns === "snapshot") {
    const { snapshots, transactions, accounts, events } = await fetchScoreSources(supabase);
    return computeConceptLive(metricKey, { snapshots, transactions, accounts, events });
  }
  return null;
}
```

Note: `computeReportLive`'s transactions param is typed `TransactionInput[]`; `ScoreTransactionInput` is assignment-compatible for the fields it reads (`postedDate`/`amount`/`direction`/`category`/`isTransfer`). If the compiler objects, widen `computeReportLive`'s param to accept the shared shape or pass `data.transactions as TransactionInput[]` at the call site (both already flow from the same DB rows). Confirm with `pnpm typecheck`.

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm test src/lib/data/concept-live.test.ts && pnpm typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/concept-live.ts src/lib/data/queries.ts src/lib/data/concept-live.test.ts
git commit -m "feat(academy): dispatch concept-live across report/metric/snapshot namespaces

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part 2 — Lesson content migration

### Per-lesson migration procedure (applies to Tasks 4–12)

Every lesson task performs the **same mechanical steps**; only the authored
content differs (specified per task). For each lesson:

1. Open the content file and `src/lib/concepts/content/revenue.ts` side by side; Revenue is the canonical shape.
2. Add these concept-level fields (mirroring Revenue's ordering): `plainEnglishSummary`, `memorableDistinction`, `formulaRows` (keep the existing `formula` string as the plain-text fallback — required alongside `formulaRows`), `comparisonRows`, `interpretation`, `whereUsed`.
3. In `lesson`, add `completionSummary` and **remove** `reinforcementPreview` (superseded by concept-level `whereUsed`). If the lesson still has `lesson.calculation.formula`, leave it — the renderer prefers `concept.formulaRows` when present; do not delete the `walkthrough`.
4. Keep `lesson.genericExample` containing the word "sample". Keep `personalApplication` exactly as-is (bindings are already correct).
5. Voice: teach through the household; no "unlocked"/"analytical depth" copy in `completionSummary`; no internal engineering language anywhere; comparison rows never rely on color alone (they render with check/✗ + text via the existing `ComparisonRows` component).
6. Run: `pnpm test src/lib/concepts/content.test.ts && pnpm typecheck` — Expected: PASS (classification, sample-labeling, no-internal-language, lesson-presence guardrails all green).
7. Commit: `git add src/lib/concepts/content/<file>.ts && git commit -m "content(academy): migrate <concept> lesson to the Slice B pattern" ` (with the co-author trailer).

The prose fields (`plainEnglishSummary`, `interpretation`, `completionSummary`, and each `comparisonRows[].explanation`) are authored to the substance specified per task, in Revenue's register. The structured fields (`memorableDistinction`, `comparisonRows` labels/`included`, `formulaRows`) are given verbatim per task — use them as written.

---

### Task 4: Migrate `operating-expenses`

**Files:** Modify `src/lib/concepts/content/operating-expenses.ts`; Test `src/lib/concepts/content.test.ts`.

Follow the per-lesson procedure with:
- `memorableDistinction`: `"An allocation is not an expense."`
- `formulaRows`: `[{label:"Housing",staticValue:"$1,900"},{label:"Food",operator:"+",staticValue:"$780"},{label:"Utilities",operator:"+",staticValue:"$320"},{label:"Transport",operator:"+",staticValue:"$450"},{label:"Other recurring",operator:"+",staticValue:"$1,300"},{label:"Operating expenses",operator:"=",staticValue:"$4,750"}]`
- `comparisonRows`: `[{label:"Rent or mortgage payment",included:true},{label:"Groceries and utilities",included:true},{label:"401(k) contribution",included:false},{label:"Transfer to savings",included:false},{label:"Extra mortgage principal",included:false}]` — explanations: included = cost of running the household; excluded = an allocation of money already kept, not a cost of operating.
- `interpretation`: rising operating expenses shrink free cash flow when revenue is flat; **lower is generally healthier**, but state it factually — a rise is a change to note and possibly investigate, never blame or a verdict on the household.
- `whereUsed`: `["Household statement (Report)","Management commentary","Free cash flow calculation","“What moved your line” on the dashboard"]`
- `completionSummary`: fluency-framed — the reader can now separate the cost of operating from allocations of what's left, and see how operating expenses drive free cash flow.
- `plainEnglishSummary`: one sentence — the recurring cost of running the household (housing, food, utilities, transport), measured against revenue; excludes money moved to savings/investments.

---

### Task 5: Migrate `cash-flow`

**Files:** Modify `src/lib/concepts/content/cash-flow.ts`; Test `src/lib/concepts/content.test.ts`.

- `memorableDistinction`: `"Cash flow is movement, not a balance."`
- `formulaRows`: `[{label:"Money in",staticValue:"$6,200"},{label:"Money out",operator:"-",staticValue:"$5,400"},{label:"Net cash flow",operator:"=",staticValue:"$800"}]`
- `comparisonRows`: `[{label:"A month's paychecks and side income",included:true},{label:"Spending that left the account this month",included:true},{label:"The current checking balance",included:false},{label:"Total savings on hand",included:false}]` — explanations: included = money that moved during the period; excluded = a point-in-time balance, which is a level, not a flow.
- `interpretation`: positive net cash flow means more came in than went out this period; a single negative month isn't automatically bad (a large planned purchase can cause it) — read the trend, not one period. Neutral framing.
- `whereUsed`: `["Personal Index (PFI) on the dashboard","Management commentary","“What moved your line”","Typical monthly free cash flow"]`
- `completionSummary`: the reader can now tell a flow (movement over a period) from a balance (a level at a moment), and read their household's cash movement.
- `plainEnglishSummary`: one sentence — the movement of money into and out of the household over a period, distinct from any account balance.
- `personalApplication` is `metric:recurring_surplus` — leave as-is (now live via Task 1).

---

### Task 6: Migrate `free-cash-flow`

**Files:** Modify `src/lib/concepts/content/free-cash-flow.ts`; Test `src/lib/concepts/content.test.ts`.

- `memorableDistinction`: `"Free cash flow is what you keep, not what you make."`
- `formulaRows`: `[{label:"Revenue",staticValue:"$6,200"},{label:"Operating expenses",operator:"-",staticValue:"$4,750"},{label:"Free cash flow",operator:"=",staticValue:"$1,450"}]`
- `comparisonRows`: `[{label:"Revenue left after operating expenses",included:true},{label:"Money available to save, invest, or pay down debt",included:true},{label:"Total revenue for the period",included:false},{label:"Money moved into savings",included:false}]` — included = what remains after the cost of operating; excluded = revenue is the top line (before costs), and a savings transfer is an allocation of free cash flow, not free cash flow itself.
- `interpretation`: free cash flow can fall even as revenue rises if operating expenses grow faster; more free cash flow means more room to save, invest, or reduce debt — stated as room, not virtue.
- `whereUsed`: `["Household statement (Report)","Management commentary","Savings-rate calculation","Personal Index (PFI)","“What moved your line”"]`
- `completionSummary`: the reader can now separate what the household makes (revenue) from what it keeps (free cash flow), the number that funds every choice.
- `plainEnglishSummary`: one sentence — revenue minus operating expenses: what the household keeps and can direct toward saving, investing, or debt.
- `personalApplication` is `report:freeCashFlow` — already live; leave as-is.

---

### Task 7: Migrate `savings-rate`

**Files:** Modify `src/lib/concepts/content/savings-rate.ts`; Test `src/lib/concepts/content.test.ts`.

- `memorableDistinction`: `"Savings rate is a share of what came in, not a dollar amount."`
- `formulaRows`: `[{label:"Retained cash",staticValue:"$620"},{label:"÷ Revenue",staticValue:"$6,200"},{label:"Savings rate",operator:"=",staticValue:"10%"}]` — figures match this file's own pre-existing `genericExample` ($620 ÷ $6,200 = 10%, already cross-consistent with free-cash-flow's $1,450 figure: $620 retained + ~$830 to investments/debt = $1,450) — do not use different numbers. Note: `operator` only supports `+`/`-`/`=`; the division is expressed in the row `label` text ("÷ Revenue"), not the `operator` field. Keep `formula: "Retained cash ÷ revenue = savings rate"` as the plain-text fallback.
- `comparisonRows`: `[{label:"Cash kept as a percentage of revenue",included:true},{label:"PFI's retained-cash ÷ revenue measure",included:true},{label:"The looser (income − spending) ÷ income rule",included:false},{label:"A flat dollar amount saved",included:false}]` — included = PFI's definition, a share of revenue; excluded = the popular alternative formula and a raw dollar figure (a rate is a ratio).
- `interpretation`: a higher savings rate means more of each revenue dollar retained, but it must be read against revenue and essential costs — a household with high essential costs isn't failing for a lower rate. No shame framing; no "higher is always good."
- `whereUsed`: `["Household statement (Report)","Management commentary","Fundamentals Score (Cash Flow dimension)","“What moved your line”"]`
- `completionSummary`: the reader can now read savings rate as a share of revenue (PFI's retained-cash ÷ revenue), distinct from the looser popular definition.
- `plainEnglishSummary`: one sentence — the share of revenue the household keeps rather than spends (retained cash ÷ revenue).
- `personalApplication` is `report:savingsRatePct` — already live; leave as-is.
- Keep the existing `householdAdaptation` (required by `content.test.ts` for `savings-rate`).

---

### Task 8: Migrate `assets`

**Files:** Modify `src/lib/concepts/content/assets.ts`; Test `src/lib/concepts/content.test.ts`.

- `memorableDistinction`: `"Assets are what you own; liabilities are what you owe."`
- `formulaRows`: `[{label:"Home",staticValue:"$225,000"},{label:"Liquid cash (checking + savings)",operator:"+",staticValue:"$9,300"},{label:"Retirement account",operator:"+",staticValue:"$18,000"},{label:"Vehicle and other items",operator:"+",staticValue:"$7,700"},{label:"Total assets",operator:"=",staticValue:"$260,000"}]` — figures match this file's own pre-existing `genericExample` exactly (don't invent different numbers); this total also feeds Task 10's net-worth figure.
- `comparisonRows`: `[{label:"Cash, checking, and savings",included:true},{label:"Investment and retirement accounts",included:true},{label:"Home and vehicle value",included:true},{label:"A credit-card balance",included:false},{label:"An outstanding loan",included:false}]` — included = things the household owns that hold value; excluded = balances owed (those are liabilities).
- `interpretation`: a larger asset base is one side of net worth, but assets alone don't show financial health — a home counts as an asset while its mortgage is a separate liability. Keep owner-created equity distinct from market appreciation when describing investment or home value.
- `whereUsed`: `["Household balance sheet (Report)","Net worth calculation","Liquidity assessment"]`
- `completionSummary`: the reader can now identify what the household owns and see how assets pair with liabilities to form net worth.
- `plainEnglishSummary`: one sentence — everything the household owns that holds value: cash, investments, and property.
- `assets` has **no** `personalApplication` — do not add one; its household section stays the labeled sample.

---

### Task 9: Migrate `liabilities`

**Files:** Modify `src/lib/concepts/content/liabilities.ts`; Test `src/lib/concepts/content.test.ts`.

- `memorableDistinction`: `"A liability is what you owe — not this month's expense."`
- `formulaRows`: `[{label:"Mortgage balance",staticValue:"$195,000"},{label:"Car loan",operator:"+",staticValue:"$12,000"},{label:"Student loan",operator:"+",staticValue:"$3,200"},{label:"Credit-card balance",operator:"+",staticValue:"$1,800"},{label:"Total liabilities",operator:"=",staticValue:"$212,000"}]` — figures match this file's own pre-existing `genericExample` exactly (also reconciles with debt-pressure's existing $12,000 car loan / $280 payment cross-reference); this total also feeds Task 10's net-worth figure.
- `comparisonRows`: `[{label:"Outstanding mortgage balance",included:true},{label:"Auto-loan and student-loan balances",included:true},{label:"Revolving credit-card balance",included:true},{label:"This month's grocery spending",included:false},{label:"A utility bill already paid",included:false}]` — included = amounts still owed; excluded = spending/expenses, which flow through operating expenses, not the liability total.
- `interpretation`: a higher liability total isn't automatically worse — a mortgage on an appreciating home differs from revolving credit-card debt. What matters is the balance against assets (net worth) and the monthly burden (debt pressure). Neutral framing.
- `whereUsed`: `["Household balance sheet (Report)","Net worth calculation","Debt-pressure assessment"]`
- `completionSummary`: the reader can now tell what the household owes (liabilities) from what it spends (operating expenses), and see how liabilities offset assets in net worth.
- `plainEnglishSummary`: one sentence — everything the household owes: mortgage, loans, and revolving balances.
- `liabilities` has **no** `personalApplication` — do not add one; sample household stays.

---

### Task 10: Migrate `net-worth`

**Files:** Modify `src/lib/concepts/content/net-worth.ts`; Test `src/lib/concepts/content.test.ts`.

- `memorableDistinction`: `"Net worth is a level, not a paycheck."`
- `formulaRows`: `[{label:"Total assets",staticValue:"$260,000"},{label:"Total liabilities",operator:"-",staticValue:"$212,000"},{label:"Net worth",operator:"=",staticValue:"$48,000"}]` — figures match this file's own pre-existing `genericExample` exactly, and are consistent with Task 8's assets total ($260,000) and Task 9's liabilities total ($212,000).
- `comparisonRows`: `[{label:"Assets minus liabilities",included:true},{label:"Equity built by paying down debt",included:true},{label:"A gain from rising home or market value",included:true},{label:"This month's income",included:false},{label:"Money in checking right now",included:false}]` — included = the stock of what's owned net of what's owed (note both owner-created equity and market appreciation contribute, but are distinct sources); excluded = income (a flow) and a single account balance (part of assets, not the whole).
- `interpretation`: net worth is a stock measured at a moment, so it moves with both owner-created equity (saving, paying down debt) **and** market appreciation — keep those distinct, because only the first reflects household behavior. Rising net worth is healthy but a single figure hides how it got there.
- `whereUsed`: `["Household balance sheet (Report)","Baseline and Waterline framing","Long-run progress view"]`
- `completionSummary`: the reader can now read net worth as owned-minus-owed at a point in time, and separate equity they built from market movement.
- `plainEnglishSummary`: one sentence — what the household owns minus what it owes, measured at a point in time.
- `personalApplication` is `snapshot:netWorth` — leave as-is (now live via Task 2).

---

### Task 11: Migrate `liquidity`

**Files:** Modify `src/lib/concepts/content/liquidity.ts`; Test `src/lib/concepts/content.test.ts`.

- `memorableDistinction`: `"Liquidity is access to cash now, not wealth on paper."`
- `formulaRows`: `[{label:"Liquid assets",staticValue:"$9,300"},{label:"÷ Monthly essential costs",staticValue:"$3,100"},{label:"Emergency runway",operator:"=",staticValue:"3.0 mo"}]` — figures match this file's own pre-existing `genericExample` exactly (also reconciles with assets' existing $9,300 liquid-cash figure). Same `÷` caveat as Task 7: the division is expressed in the row `label` text, not the `operator` field (which only supports `+`/`-`/`=`). Keep `formula: "Liquid assets ÷ monthly essential costs = runway in months"`.
- `comparisonRows`: `[{label:"Cash and immediately available savings",included:true},{label:"Money reachable within days without penalty",included:true},{label:"Home equity",included:false},{label:"Retirement funds locked until later",included:false}]` — included = what can cover costs right away; excluded = value that exists but can't be spent on short notice.
- `interpretation`: more runway means more resilience to a shock, not that the household is wealthier — a high net worth with little liquidity can still be cash-strapped. Frame as resilience, not virtue; no "more is always better" verdict.
- `whereUsed`: `["Fundamentals Score (Liquidity & Resilience dimension)","Available Capital","Financial-flexibility assessment"]`
- `completionSummary`: the reader can now tell liquidity (cash reachable now) from wealth (value that may be locked up), and read their emergency runway.
- `plainEnglishSummary`: one sentence — how readily the household can cover costs from cash on hand, expressed as months of runway.
- `personalApplication` is `metric:liquid_runway_months` — leave as-is (now live via Task 1). Keep existing `householdAdaptation` (classification is `household_adaptation`).

---

### Task 12: Migrate `debt-pressure`

**Files:** Modify `src/lib/concepts/content/debt-pressure.ts`; Test `src/lib/concepts/content.test.ts`.

- `memorableDistinction`: `"Debt pressure is the burden of payments, not the size of the debt."`
- `formulaRows`: `[{label:"Monthly debt payments",staticValue:"$360"},{label:"÷ Monthly income",staticValue:"$6,200"},{label:"Debt burden",operator:"=",staticValue:"5.8%"}]` — figures match this file's own pre-existing `genericExample` exactly ($360 = $280 car loan + $45 student loan + $35 credit-card minimum, ÷ $6,200 revenue ≈ 5.8%; also reconciles with liabilities' existing $12,000 car loan / $280 payment cross-reference). Same `÷` caveat; keep `formula: "Monthly debt payments ÷ monthly income = debt burden"`.
- `comparisonRows`: `[{label:"Share of income going to debt payments",included:true},{label:"Required minimums plus scheduled loan payments",included:true},{label:"The total balance owed",included:false},{label:"A one-time large purchase paid in cash",included:false}]` — included = the recurring payment burden relative to income; excluded = the balance itself (a large balance at a low rate can carry a light burden) and cash purchases (no debt service).
- `interpretation`: **lower is healthier** — a lower ratio means fewer income dollars committed to debt service each month. State this explicitly so the value-neutral delta isn't misread; frame a rising ratio as more of each dollar committed to debt, never as failure or blame.
- `whereUsed`: `["Fundamentals Score (Debt dimension)","Management commentary","“What moved your line”"]`
- `completionSummary`: the reader can now read debt pressure as the monthly burden relative to income (lower is easier to carry), separate from the total balance owed.
- `plainEnglishSummary`: one sentence — the share of monthly income committed to debt payments; a burden measure, not the balance.
- `personalApplication` is `metric:debt_service_ratio` — leave as-is (now live via Task 1). Keep existing `householdAdaptation` (classification `household_adaptation`).

---

## Part 3 — Tests, docs, verification

### Task 13: Extend e2e coverage for a migrated non-Revenue lesson

**Files:** Modify `e2e/academy.spec.ts`.

**Interfaces:** Consumes the existing academy e2e fixtures/helpers (password user, demo-data load) already used by the Revenue tests in this file.

- [ ] **Step 1: Add a test asserting the migrated-lesson pattern**

Add a test (patterned on the existing Revenue deep-link test in this file — read it first for the exact helper names, `data-testid`s, and selectors it uses) that deep-links into a `metric:`-bound lesson with a demo profile loaded — use `/academy/debt-pressure` (or `/academy/liquidity`) — and asserts:
- the memorable distinction text renders (e.g. `getByText(/burden of payments, not the size/i)`);
- at least one comparison row renders with its text label (not color-only);
- the household-application block shows the "Calculated from your data" label (the live path now resolves for `metric:` bindings).

Mirror the existing test's setup/teardown exactly; do not introduce a new fixture pattern.

- [ ] **Step 2: Run the targeted e2e spec**

Run: `pnpm test:e2e e2e/academy.spec.ts`
Expected: PASS (the new test plus the unchanged Revenue tests). Transient Supabase/CSV sandbox flakes are known (see CURRENT_PHASE "Test status"); re-run once to rule them out before treating a failure as a regression.

- [ ] **Step 3: Commit**

```bash
git add e2e/academy.spec.ts
git commit -m "test(e2e): assert the Slice B lesson pattern on a metric-bound lesson

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Docs + full `pnpm check` + live browser verification

**Files:** Modify `docs/DECISIONS.md`, `docs/CURRENT_PHASE.md`, `docs/KNOWN_LIMITATIONS.md`.

- [ ] **Step 1: Record the decision in `docs/DECISIONS.md`**

Append a new numbered decision (use the next number after the highest existing entry — check the file): the `concept-live` resolver was extended to the `metric:` and `snapshot:` namespaces in Slice B (rather than deferred), so cash-flow, liquidity, debt-pressure, and net-worth lessons render live household data; `position:` remains unimplemented (no Slice B lesson needs it). Alternative considered: content-only Slice B leaving those four on the sample household. Reasoning: the "apply it to your household" promise. Follow the file's existing entry format (date, decision, alternatives, reasoning, consequences).

- [ ] **Step 2: Update `docs/CURRENT_PHASE.md`**

Add a "Completed (this phase — Academy content-refinement Slice B)" section summarizing the 9-lesson migration and the resolver extension; move the Slice B item out of "Next priorities" and note Slice C (13 definition sheets) as the remaining content-refinement work.

- [ ] **Step 3: Update `docs/KNOWN_LIMITATIONS.md` only if warranted**

If nothing new was deferred, add nothing. If a lesson deferred something (it should not), record it. Do **not** invent a limitation.

- [ ] **Step 4: Run the full gate**

Run: `pnpm check`
Expected: lint + typecheck + unit tests + build all green. Fix anything red before proceeding.

- [ ] **Step 5: Live browser verification**

Start the dev server; sign in as an ephemeral password user with a demo profile loaded (per the fixture pattern in `e2e/fixtures/password-user.ts`). At **390×844 first, then 1280×900**, verify:
- `/academy/free-cash-flow` (`report:`), `/academy/liquidity` or `/academy/debt-pressure` (`metric:`), and `/academy/net-worth` (`snapshot:`) each render an "Applied to your household" block reading "Calculated from your data" with a real figure and a signed vs-prior delta;
- `/academy/assets` renders the labeled sample household (no live block) — correct by design;
- each migrated lesson shows the memorable-distinction callout and comparison rows with check/✗ **and** text (no color-alone);
- `document.documentElement.scrollWidth === clientWidth` at 390px (no horizontal overflow); zero console errors on every page/viewport.

Delete the ephemeral user and stop the dev server afterward.

- [ ] **Step 6: Commit docs**

```bash
git add docs/DECISIONS.md docs/CURRENT_PHASE.md docs/KNOWN_LIMITATIONS.md
git commit -m "docs(academy): record Slice B — 9-lesson migration + resolver extension

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (for the executor)

- Every Slice B lesson from the spec's table has a task (Tasks 4–12 = the 9 lessons; Revenue and score-index-divergence were already migrated pre-slice and are not touched).
- Resolver namespaces: `report:` unchanged, `metric:`/`snapshot:` added (Tasks 1–3); `position:` deliberately unimplemented and returns `null` (asserted in Task 3's dispatch test).
- The `÷` operator is not in `FormulaRow.operator`'s union (`+`/`-`/`=` only) — Tasks 7, 11, 12 handle division via the `formula` text fallback and/or the row `label`, never by adding to the union (no schema change).
- `assets` and `liabilities` intentionally have no `personalApplication` — Tasks 8–9 explicitly say not to add one.
