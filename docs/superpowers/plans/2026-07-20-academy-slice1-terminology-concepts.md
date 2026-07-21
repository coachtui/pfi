# Academy Slice 1: Terminology Governance + Concept Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the terminology foundation of the PFI Academy pivot — a framework-free typed concept/glossary system (`src/lib/concepts/`) with 15 authored concepts, plus the approved renames that make the live product speak one canonical financial language.

**Architecture:** Content lives in the repo as typed TypeScript records (one file per concept), validated by unit tests rather than runtime checks. `src/lib/concepts/` follows the same extraction rule as `financial-engine`: zero React/Next imports. Renames are label-only — every computed value stays bit-identical. Spec: `docs/superpowers/specs/2026-07-20-academy-slice1-terminology-concepts-design.md`.

**Tech Stack:** TypeScript (strict), Vitest, pnpm. No new dependencies. No DB migration. No new UI.

## Global Constraints

- `src/lib/concepts/` must contain **no React/Next imports** (same rule as `src/lib/financial-engine`).
- **No metric formula changes anywhere.** Metric **ids** (`net_cash_flow_margin`, `recurring_surplus`) never change — only `name` strings.
- Canonical labels (from the approved audit): "Free cash flow", "Free cash flow margin", "Typical monthly free cash flow", "Owner-created equity", "Available capital" (kept, casing normalized), "Savings rate" (kept, = retained cash ÷ revenue).
- Banned as standalone metric nouns in UI/narration: "surplus", "shortfall", "profit", "disposable income", "available cash".
- Content tone: no shame language, no exaggerated praise/alarm, neutral interpretation framings (per `docs/AI_RECOMMENDATION_POLICY.md`). Intros assume zero financial knowledge.
- Sample household in all generic examples: **"the Rivera household"** — revenue $6,200/mo, operating expenses $4,750/mo, free cash flow $1,450/mo, liquid assets $9,300, revolving balance $1,800, near-term obligations $2,600, net worth $48,000. Use these exact figures everywhere so examples cross-reference cleanly; always label them as sample figures.
- Run `pnpm test <file>` per task; `pnpm check` must be green before the final task completes.
- Commit after every task (at minimum); use conventional-commit style messages ending with the Claude Code trailer.

---

### Task 1: Concept types, registry, and validators

**Files:**
- Create: `src/lib/concepts/types.ts`
- Create: `src/lib/concepts/registry.ts`
- Test: `src/lib/concepts/registry.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces: all types below; `buildRegistry(concepts, modules)` → `ConceptRegistry`; `validateRegistry(concepts, modules)` → `string[]` (empty = valid). Later tasks import these exact names from `./types` and `./registry`.

- [ ] **Step 1: Write `types.ts`** (types only — no test needed for type declarations)

```ts
// src/lib/concepts/types.ts
/**
 * PFI Academy concept system. Framework-free (no React/Next imports) so it
 * can be extracted to a package later, like financial-engine and demo-data.
 * Content is compile-time data validated by unit tests (registry.test.ts,
 * content.test.ts) — there is no runtime CMS.
 * Normative spec: docs/superpowers/specs/2026-07-20-academy-slice1-terminology-concepts-design.md
 * Governance: docs/TERMINOLOGY.md
 */

/** Stable kebab-case slug, e.g. "free-cash-flow". The slug IS the id. */
export type ConceptId = string;

/**
 * What household data must exist before a lesson's personalApplication can
 * render real figures (Slice 3+ renderers check this; Slice 1 only declares it).
 */
export type DataRequirement =
  | "income-transactions"
  | "spending-transactions"
  | "balance-history"
  | "debt-accounts"
  | "recurring-obligations";

export type KnowledgeCheck =
  | { kind: "interpretation"; prompt: string; choices: string[]; correctIndex: number; explanation: string }
  | { kind: "identify-figure"; prompt: string; choices: string[]; correctIndex: number; explanation: string }
  | { kind: "which-action"; prompt: string; choices: string[]; correctIndex: number; explanation: string };

export interface PersonalApplication {
  /**
   * Namespaced engine binding — never a literal figure:
   *   "metric:<metric registry id>"      e.g. "metric:liquid_runway_months"
   *   "report:<PeriodStatement field>"   e.g. "report:freeCashFlow"
   *   "snapshot:<DailySnapshot field>"   e.g. "snapshot:netWorth"
   *   "position:<position.ts function>"  e.g. "position:availablePosition"
   * Validated against the real engine in content.test.ts.
   */
  metricKey: string;
  /** How renderers frame positive/negative/strengthening/weakening/unavailable. Neutral tone only. */
  interpretationRules: string;
  requiresData: DataRequirement[];
}

/** The 10-part lesson template (spec §Lesson template). */
export interface Lesson {
  intro: string;                      // 1. plain language, assumes zero prior knowledge
  standardTerm: string;               // 2. the real terminology and how business/investing uses it
  whyItMattersExtended?: string;      // 3. optional extension of concept.whyItMatters
  calculation?: { formula: string; walkthrough: string }; // 4.
  genericExample: string;             // 5. Rivera-household sample, labeled as sample
  personalApplication?: PersonalApplication; // 6–7. binding, not prose
  commonMisunderstanding: string;     // 8.
  knowledgeCheck: KnowledgeCheck[];   // 9. one or two items (validated)
  reinforcementPreview: string;       // 10. where this appears throughout PFI
}

export interface FinancialConcept {
  id: ConceptId;
  title: string;                      // canonical name, e.g. "Free cash flow"
  shortDefinition: string;            // one sentence; the pre-completion tap definition
  fullDefinition: string;
  whyItMatters: string;
  formula?: string;                   // display string, e.g. "Revenue − operating expenses"
  /** Required when the household formula differs from the strict business definition. */
  householdAdaptation?: string;
  businessContext?: string;
  commonMisunderstanding?: string;
  relatedConceptIds: ConceptId[];
  prerequisiteConceptIds: ConceptId[];
  dataMetricKey?: string;             // same namespace as PersonalApplication.metricKey
  status: "draft" | "published" | "archived";
  lesson?: Lesson;                    // absent = glossary-only record
}

export interface Module {
  id: string;
  title: string;
  order: number;
  /** Lesson order = array order. Glossary-only concepts may appear here too (taught inline). */
  conceptIds: ConceptId[];
}
```

- [ ] **Step 2: Write the failing registry test**

```ts
// src/lib/concepts/registry.test.ts
import { describe, expect, it } from "vitest";
import { buildRegistry, validateRegistry } from "./registry";
import type { FinancialConcept, Module } from "./types";

const concept = (id: string, over: Partial<FinancialConcept> = {}): FinancialConcept => ({
  id,
  title: id,
  shortDefinition: "One sentence.",
  fullDefinition: "Full definition.",
  whyItMatters: "Why it matters.",
  relatedConceptIds: [],
  prerequisiteConceptIds: [],
  status: "published",
  ...over,
});

const lesson = (over: Partial<NonNullable<FinancialConcept["lesson"]>> = {}) => ({
  intro: "Intro.",
  standardTerm: "Term.",
  genericExample: "Example.",
  commonMisunderstanding: "Misunderstanding.",
  knowledgeCheck: [
    { kind: "interpretation" as const, prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "Because." },
  ],
  reinforcementPreview: "Preview.",
  ...over,
});

const mod = (id: string, conceptIds: string[], order = 1): Module => ({ id, title: id, order, conceptIds });

describe("buildRegistry", () => {
  it("looks up concepts by id and filters published", () => {
    const draft = concept("b", { status: "draft" });
    const reg = buildRegistry([concept("a"), draft], [mod("m1", ["a"])]);
    expect(reg.byId("a")?.title).toBe("a");
    expect(reg.byId("missing")).toBeUndefined();
    expect(reg.published().map((c) => c.id)).toEqual(["a"]);
    expect(reg.forModule("m1").map((c) => c.id)).toEqual(["a"]);
  });
});

describe("validateRegistry", () => {
  it("accepts a valid registry", () => {
    const a = concept("a");
    const b = concept("b", { prerequisiteConceptIds: ["a"], relatedConceptIds: ["a"], lesson: lesson() });
    expect(validateRegistry([a, b], [mod("m1", ["a", "b"])])).toEqual([]);
  });

  it("rejects duplicate ids", () => {
    expect(validateRegistry([concept("a"), concept("a")], [])).toContainEqual(expect.stringContaining("duplicate"));
  });

  it("rejects non-kebab-case ids", () => {
    expect(validateRegistry([concept("Free Cash Flow")], [])).toContainEqual(expect.stringContaining("kebab-case"));
  });

  it("rejects unknown related/prerequisite ids", () => {
    const errs = validateRegistry([concept("a", { relatedConceptIds: ["ghost"], prerequisiteConceptIds: ["ghost2"] })], []);
    expect(errs).toContainEqual(expect.stringContaining("ghost"));
    expect(errs).toContainEqual(expect.stringContaining("ghost2"));
  });

  it("rejects prerequisite cycles", () => {
    const a = concept("a", { prerequisiteConceptIds: ["b"] });
    const b = concept("b", { prerequisiteConceptIds: ["a"] });
    expect(validateRegistry([a, b], [])).toContainEqual(expect.stringContaining("cycle"));
  });

  it("rejects modules referencing unknown concepts", () => {
    expect(validateRegistry([concept("a")], [mod("m1", ["a", "ghost"])])).toContainEqual(
      expect.stringContaining("ghost"),
    );
  });

  it("rejects lessons with zero or more than two knowledge checks", () => {
    const zero = concept("a", { lesson: lesson({ knowledgeCheck: [] }) });
    const three = concept("b", {
      lesson: lesson({
        knowledgeCheck: [
          { kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "x" },
          { kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "x" },
          { kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 0, explanation: "x" },
        ],
      }),
    });
    const errs = validateRegistry([zero, three], []);
    expect(errs.filter((e) => e.includes("knowledge check"))).toHaveLength(2);
  });

  it("rejects out-of-bounds correctIndex", () => {
    const bad = concept("a", {
      lesson: lesson({
        knowledgeCheck: [{ kind: "interpretation", prompt: "?", choices: ["a", "b"], correctIndex: 2, explanation: "x" }],
      }),
    });
    expect(validateRegistry([bad], [])).toContainEqual(expect.stringContaining("correctIndex"));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/lib/concepts/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 4: Implement `registry.ts`**

```ts
// src/lib/concepts/registry.ts
import type { FinancialConcept, Module } from "./types";

export interface ConceptRegistry {
  byId(id: string): FinancialConcept | undefined;
  published(): FinancialConcept[];
  forModule(moduleId: string): FinancialConcept[];
  concepts: FinancialConcept[];
  modules: Module[];
}

export function buildRegistry(concepts: FinancialConcept[], modules: Module[]): ConceptRegistry {
  const map = new Map(concepts.map((c) => [c.id, c]));
  const sortedModules = [...modules].sort((a, b) => a.order - b.order);
  return {
    concepts,
    modules: sortedModules,
    byId: (id) => map.get(id),
    published: () => concepts.filter((c) => c.status === "published"),
    forModule: (moduleId) => {
      const m = modules.find((x) => x.id === moduleId);
      return m ? m.conceptIds.flatMap((id) => map.get(id) ?? []) : [];
    },
  };
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Returns a list of human-readable problems; empty array = valid. */
export function validateRegistry(concepts: FinancialConcept[], modules: Module[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const c of concepts) {
    if (ids.has(c.id)) errors.push(`duplicate concept id: ${c.id}`);
    ids.add(c.id);
    if (!KEBAB.test(c.id)) errors.push(`concept id is not kebab-case: ${c.id}`);
  }

  for (const c of concepts) {
    for (const rel of c.relatedConceptIds) {
      if (!ids.has(rel)) errors.push(`${c.id}: unknown relatedConceptId ${rel}`);
    }
    for (const pre of c.prerequisiteConceptIds) {
      if (!ids.has(pre)) errors.push(`${c.id}: unknown prerequisiteConceptId ${pre}`);
    }
    const checks = c.lesson?.knowledgeCheck;
    if (checks && (checks.length < 1 || checks.length > 2)) {
      errors.push(`${c.id}: lessons need 1–2 knowledge checks, found ${checks.length}`);
    }
    for (const [i, check] of (checks ?? []).entries()) {
      if (check.correctIndex < 0 || check.correctIndex >= check.choices.length) {
        errors.push(`${c.id}: knowledge check ${i} correctIndex out of bounds`);
      }
    }
  }

  // Prerequisite cycle detection (DFS, three-color).
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const visit = (id: string): boolean => {
    if (state.get(id) === "done") return false;
    if (state.get(id) === "visiting") return true;
    state.set(id, "visiting");
    const found = (byId.get(id)?.prerequisiteConceptIds ?? []).some((pre) => byId.has(pre) && visit(pre));
    state.set(id, "done");
    return found;
  };
  for (const c of concepts) {
    if (state.get(c.id) === undefined && visit(c.id)) {
      errors.push(`prerequisite cycle involving ${c.id}`);
      break;
    }
  }

  for (const m of modules) {
    for (const cid of m.conceptIds) {
      if (!ids.has(cid)) errors.push(`module ${m.id}: unknown concept ${cid}`);
    }
  }

  return errors;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/lib/concepts/registry.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/concepts/
git commit -m "feat(concepts): concept types, registry, and validators

Foundation of the PFI Academy terminology system (spec
docs/superpowers/specs/2026-07-20-academy-slice1-terminology-concepts-design.md).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Module 1 content — How Your Household Operates (5 concepts)

**Files:**
- Create: `src/lib/concepts/content/revenue.ts`, `operating-expenses.ts`, `cash-flow.ts`, `free-cash-flow.ts`, `savings-rate.ts`
- Create: `src/lib/concepts/content/index.ts` (exports `ALL_CONCEPTS: FinancialConcept[]`)
- Create: `src/lib/concepts/modules.ts` (exports `MODULES: Module[]`)
- Create: `src/lib/concepts/index.ts` (public barrel: `CONCEPT_REGISTRY = buildRegistry(ALL_CONCEPTS, MODULES)` plus type re-exports)
- Test: `src/lib/concepts/content.test.ts`

**Interfaces:**
- Consumes: `FinancialConcept`, `Module`, `buildRegistry`, `validateRegistry` from Task 1.
- Produces: `ALL_CONCEPTS`, `MODULES`, `CONCEPT_REGISTRY`. Tasks 3–5 append to `ALL_CONCEPTS`/`MODULES` and extend `content.test.ts` counts.

- [ ] **Step 1: Write the failing content test**

```ts
// src/lib/concepts/content.test.ts
import { describe, expect, it } from "vitest";
import { ALL_CONCEPTS } from "./content";
import { MODULES } from "./modules";
import { validateRegistry } from "./registry";

describe("authored content", () => {
  it("passes registry validation", () => {
    expect(validateRegistry(ALL_CONCEPTS, MODULES)).toEqual([]);
  });

  it("has Module 1 with its five concepts in teaching order", () => {
    const m1 = MODULES.find((m) => m.id === "how-your-household-operates");
    expect(m1?.conceptIds).toEqual(["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"]);
  });

  it("publishes every concept", () => {
    expect(ALL_CONCEPTS.every((c) => c.status === "published")).toBe(true);
  });

  it("gives every Module 1 concept a full lesson", () => {
    for (const id of ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"]) {
      expect(ALL_CONCEPTS.find((c) => c.id === id)?.lesson, id).toBeDefined();
    }
  });

  it("requires householdAdaptation on household-adapted terms", () => {
    // Terms whose PFI formula deviates from the strict corporate definition (audit ruling).
    for (const id of ["revenue", "operating-expenses", "free-cash-flow", "savings-rate"]) {
      const c = ALL_CONCEPTS.find((x) => x.id === id);
      expect(c?.householdAdaptation, id).toBeTruthy();
    }
  });

  it("labels sample figures as sample in every generic example", () => {
    for (const c of ALL_CONCEPTS) {
      if (c.lesson) expect(c.lesson.genericExample.toLowerCase(), c.id).toContain("sample");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/concepts/content.test.ts`
Expected: FAIL — cannot resolve `./content`.

- [ ] **Step 3: Author the five concepts, modules, and barrels**

`free-cash-flow.ts` is the **gold-standard exemplar** — match its depth, tone, and structure in every other lesson-bearing concept (here and in Tasks 3–4):

```ts
// src/lib/concepts/content/free-cash-flow.ts
import type { FinancialConcept } from "../types";

export const freeCashFlow: FinancialConcept = {
  id: "free-cash-flow",
  title: "Free cash flow",
  shortDefinition: "The money remaining after the expenses required to operate your household have been paid.",
  fullDefinition:
    "Free cash flow is what's left of your household's revenue after operating expenses are paid. It is the cash your household is free to allocate — to savings, investments, or paying down debt. A household can own valuable things and still have weak free cash flow, or own little and generate strong free cash flow.",
  whyItMatters:
    "Free cash flow is the engine of financial progress. Every dollar of savings, investing, and debt paydown comes out of it. Investors watch a company's free cash flow because it shows what the business really generates after keeping the lights on — the same question applies to a household.",
  formula: "Revenue − operating expenses",
  householdAdaptation:
    "In corporate accounting, free cash flow is operating cash flow minus capital expenditures. PFI's household version is simpler: revenue minus operating expenses. The idea is the same — cash generated after the cost of operating — without corporate adjustments that don't apply to households.",
  businessContext:
    "Public companies report free cash flow to show how much cash the business generates beyond what it must spend to operate. It funds dividends, buybacks, debt paydown, and growth — a company's version of your allocation choices.",
  commonMisunderstanding:
    "Free cash flow is not the balance in your checking account. A balance is what you hold right now; free cash flow is what a period of operating produced. You can hold a large balance while your free cash flow is negative — spending down what you saved earlier.",
  relatedConceptIds: ["cash-flow", "savings-rate", "retained-cash", "capital-allocation"],
  prerequisiteConceptIds: ["revenue", "operating-expenses"],
  dataMetricKey: "report:freeCashFlow",
  status: "published",
  lesson: {
    intro:
      "Think of your household as a small company. Money comes in; running the household costs money; whatever is left over is yours to direct. That leftover amount has a name professionals use constantly: free cash flow.",
    standardTerm:
      "“Free cash flow” (often abbreviated FCF) is one of the most-watched numbers in business and investing. When analysts ask whether a company “generates cash,” this is the number they mean.",
    calculation: {
      formula: "Revenue − operating expenses = free cash flow",
      walkthrough:
        "Add up everything your household earned in the period (revenue). Subtract what it cost to operate — housing, food, utilities, transport, and other operating expenses. Transfers between your own accounts don't count as either. What remains is free cash flow.",
    },
    genericExample:
      "Sample figures: the Rivera household earns $6,200 of revenue in a month and pays $4,750 of operating expenses. Their free cash flow is $6,200 − $4,750 = $1,450. That $1,450 is what they can direct toward savings, investments, or extra debt payments.",
    personalApplication: {
      metricKey: "report:freeCashFlow",
      interpretationRules:
        "Positive: the household generated cash this period; describe the amount as available for allocation. Negative: operating costs exceeded revenue this period; state it plainly without alarm and note which side (revenue or expenses) moved. Zero or near zero: the household roughly broke even. Unavailable: say which data is missing (income or spending transactions); never estimate.",
      requiresData: ["income-transactions", "spending-transactions"],
    },
    commonMisunderstanding:
      "Free cash flow is not the same as the balance in your checking account, and it is not the same as your savings rate. The balance is a snapshot of what you hold; free cash flow measures what one period of operating produced; the savings rate measures how much of revenue you kept as cash.",
    knowledgeCheck: [
      {
        kind: "identify-figure",
        prompt: "Sample figures: a household earns $5,000 in a month and its operating expenses are $4,200. What is its free cash flow?",
        choices: ["$800", "$5,000", "$4,200", "Whatever is in its checking account"],
        correctIndex: 0,
        explanation: "Free cash flow = revenue − operating expenses = $5,000 − $4,200 = $800. The checking balance is a snapshot, not a flow.",
      },
      {
        kind: "which-action",
        prompt: "Which action would increase a household's free cash flow next month?",
        choices: [
          "Reducing a recurring operating expense",
          "Moving money from savings to checking",
          "Checking the account balance more often",
          "Renaming a spending category",
        ],
        correctIndex: 0,
        explanation:
          "Free cash flow only moves when revenue or operating expenses move. Transfers between your own accounts and relabeling don't change it.",
      },
    ],
    reinforcementPreview:
      "Free cash flow appears throughout PFI: the report's statement and management commentary, the Free cash flow margin metric inside your PFI Score's Cash Flow dimension, and drivers on your dashboard's “What moved your line.”",
  },
};
```

The other four follow the same template. Author each completely, using these exact field rulings (tone and depth mirror the exemplar; all generic examples use the Rivera sample figures from Global Constraints and include the word "sample"):

**`revenue.ts`** — id `revenue`, title "Revenue".
- shortDefinition: "All the money your household brings in — pay, side income, benefits, and other earnings."
- formula: "Sum of all money earned in the period (transfers between your own accounts excluded)".
- householdAdaptation: corporate revenue means sales of goods/services; household revenue counts every income source (wages, side income, benefits). Refunds reduce spending rather than counting as revenue.
- businessContext: "the top line" — the number growth is judged against.
- commonMisunderstanding: revenue is not what you keep — that's free cash flow; a raise can vanish into operating expenses.
- related: `operating-expenses`, `cash-flow`; prerequisites: none. dataMetricKey: `report:revenue`.
- personalApplication: metricKey `report:revenue`, requiresData `["income-transactions"]`; interpretationRules: describe the period total and its stability; if income is irregular, say so neutrally; unavailable → name the missing data.
- knowledgeCheck: one `identify-figure` (which of four money events is revenue: paycheck vs. transfer from savings vs. credit-card refund vs. loan disbursement — paycheck) + one `interpretation` (revenue rose but free cash flow fell — what happened? operating expenses rose faster).

**`operating-expenses.ts`** — id `operating-expenses`, title "Operating expenses".
- shortDefinition: "The recurring cost of running your household — housing, food, utilities, transport, and similar spending."
- formula: "Sum of household spending in the period (transfers, savings, and investment contributions excluded)".
- householdAdaptation: corporate OpEx excludes cost of goods sold and capital purchases; the household version is simply all operating spending — money moved to savings or investments is allocation, not expense.
- businessContext: investors track operating expenses against revenue to judge discipline ("operating leverage").
- commonMisunderstanding: putting money into savings or investments is not an operating expense — it's an allocation of free cash flow.
- related: `revenue`, `free-cash-flow`; prerequisites: `revenue`. dataMetricKey: `report:operatingExpenses`.
- personalApplication: metricKey `report:operatingExpenses`, requiresData `["spending-transactions"]`; interpretationRules: report the period total and direction vs. prior period; rising expenses stated factually, never as blame.
- knowledgeCheck: one `identify-figure` (which is an operating expense: rent vs. 401(k) contribution vs. transfer to savings vs. extra mortgage-principal payment — rent) + one `interpretation`.

**`cash-flow.ts`** — id `cash-flow`, title "Cash flow".
- shortDefinition: "The movement of money into and out of your household over a period of time."
- formula: "Money in − money out, over a period".
- householdAdaptation: none needed (omit field — the general meaning transfers directly; the test in Step 1 only requires it for the four audit-ruled ids).
- businessContext: companies publish an entire cash-flow statement; "cash is king" refers to this.
- commonMisunderstanding: cash flow is a movie, not a photograph — a large balance (photograph) can hide negative cash flow (movie).
- related: `revenue`, `operating-expenses`, `free-cash-flow`; prerequisites: `revenue`, `operating-expenses`. dataMetricKey: `metric:recurring_surplus` (the metric renamed "Typical monthly free cash flow" in Task 5 — the id is stable).
- personalApplication: metricKey `metric:recurring_surplus`, requiresData `["income-transactions", "spending-transactions"]`; interpretationRules: describe the typical monthly net flow; emphasize direction and steadiness over the raw amount.
- knowledgeCheck: one `interpretation` (balance high but cash flow negative — what does it mean? spending down earlier savings).

**`savings-rate.ts`** — id `savings-rate`, title "Savings rate".
- shortDefinition: "The share of your revenue you kept as cash this period."
- formula: "Retained cash ÷ revenue".
- householdAdaptation: **canonical PFI definition (audit ruling): retained cash ÷ revenue.** People often use "savings rate" loosely for (income − spending) ÷ income — in PFI that is the Free cash flow margin, a different metric. PFI's savings rate counts only what stayed as cash; money allocated to investments or debt paydown is tracked separately.
- businessContext: analogous to a company's cash-retention decisions after generating free cash flow.
- commonMisunderstanding: a low savings rate is not automatically bad — a household can have a strong free cash flow margin and deliberately allocate to investments and debt paydown instead of cash.
- related: `free-cash-flow`, `retained-cash`, `capital-allocation`; prerequisites: `free-cash-flow`. dataMetricKey: `report:savingsRatePct`.
- personalApplication: metricKey `report:savingsRatePct`, requiresData `["income-transactions", "spending-transactions"]`; interpretationRules: state the percentage and what it means in dollars; when 0%, check whether FCF went to investments/debt before describing it as "kept nothing"; never praise extreme austerity.
- knowledgeCheck: one `interpretation` (household with 5% savings rate but large investment contributions — weak saver? No: allocation choice) + one `identify-figure`.

Then the wiring:

```ts
// src/lib/concepts/content/index.ts
import type { FinancialConcept } from "../types";
import { revenue } from "./revenue";
import { operatingExpenses } from "./operating-expenses";
import { cashFlow } from "./cash-flow";
import { freeCashFlow } from "./free-cash-flow";
import { savingsRate } from "./savings-rate";

export const ALL_CONCEPTS: FinancialConcept[] = [revenue, operatingExpenses, cashFlow, freeCashFlow, savingsRate];
```

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
];
```

```ts
// src/lib/concepts/index.ts
import { ALL_CONCEPTS } from "./content";
import { MODULES } from "./modules";
import { buildRegistry } from "./registry";

export type { ConceptId, DataRequirement, FinancialConcept, KnowledgeCheck, Lesson, Module, PersonalApplication } from "./types";
export { buildRegistry, validateRegistry, type ConceptRegistry } from "./registry";
export { ALL_CONCEPTS } from "./content";
export { MODULES } from "./modules";

export const CONCEPT_REGISTRY = buildRegistry(ALL_CONCEPTS, MODULES);
```

Note: `free-cash-flow.ts` references `retained-cash` and `capital-allocation` (`savings-rate.ts` too), which don't exist until Task 4. **`validateRegistry` will correctly fail on them.** For this task only, keep those ids out of `relatedConceptIds` and add them in Task 4 when the records exist — the plan's Task 4 step 3 includes re-adding them. Ship Task 2 with: free-cash-flow related = `["cash-flow", "savings-rate"]`, savings-rate related = `["free-cash-flow"]`.

- [ ] **Step 4: Run the tests**

Run: `pnpm test src/lib/concepts/`
Expected: PASS (registry + content suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts/
git commit -m "feat(concepts): Module 1 content — how your household operates

Revenue, operating expenses, cash flow, free cash flow (exemplar), and
savings rate, with the audit's canonical savings-rate ruling
(retained cash ÷ revenue) encoded in content.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Module 2 content — Reading Your Household Balance Sheet (4 concepts)

**Files:**
- Create: `src/lib/concepts/content/assets.ts`, `liabilities.ts`, `net-worth.ts`, `liquidity.ts`
- Modify: `src/lib/concepts/content/index.ts` (append 4 imports/entries)
- Modify: `src/lib/concepts/modules.ts` (append module 2)
- Modify: `src/lib/concepts/content.test.ts`

**Interfaces:**
- Consumes: types + `ALL_CONCEPTS`/`MODULES` wiring from Tasks 1–2.
- Produces: 4 more published concepts; module id `reading-your-household-balance-sheet`.

- [ ] **Step 1: Extend the content test (failing first)**

Add to `content.test.ts`:

```ts
  it("has Module 2 with its four concepts in teaching order", () => {
    const m2 = MODULES.find((m) => m.id === "reading-your-household-balance-sheet");
    expect(m2?.conceptIds).toEqual(["assets", "liabilities", "net-worth", "liquidity"]);
  });

  it("gives every Module 2 concept a full lesson", () => {
    for (const id of ["assets", "liabilities", "net-worth", "liquidity"]) {
      expect(ALL_CONCEPTS.find((c) => c.id === id)?.lesson, id).toBeDefined();
    }
  });
```

Run: `pnpm test src/lib/concepts/content.test.ts` — expected: the two new tests FAIL.

- [ ] **Step 2: Author the four concepts** (full lessons, exemplar depth, Rivera sample figures, "sample" labeled)

**`assets.ts`** — id `assets`, title "Assets".
- shortDefinition: "Everything your household owns that has monetary value."
- formula: none (definitional concept).
- businessContext: the left side of a company's balance sheet; investors read asset composition, not just the total.
- commonMisunderstanding: an asset's value is not cash — a car is an asset, but you can't pay rent with it today (that's liquidity, the Module 2 finale).
- related: `liabilities`, `net-worth`, `liquidity`; prerequisites: none. dataMetricKey: omit (the v1 engine exposes no total-assets field — the personalized view arrives when balance coverage expands; the lesson says exactly that). personalApplication: omit.
- knowledgeCheck: one `identify-figure` (which is an asset: savings balance vs. credit-card balance vs. monthly rent vs. salary — savings balance).

**`liabilities.ts`** — id `liabilities`, title "Liabilities".
- shortDefinition: "Everything your household owes to someone else."
- formula: none (definitional concept).
- businessContext: the right side of the balance sheet; analysts compare liabilities against assets and cash generation.
- commonMisunderstanding: a monthly payment is not the liability — the payment services the liability; the liability is the full balance owed.
- related: `assets`, `net-worth`, `debt-pressure`; prerequisites: `assets`. **Note:** `debt-pressure` doesn't exist until Task 4 — ship Task 3 with related = `["assets", "net-worth"]` and add `debt-pressure` in Task 4. dataMetricKey: omit (same v1 coverage note as assets; `snapshot:revolvingBalances` covers only revolving debt, so binding it would misrepresent the total). personalApplication: omit.
- knowledgeCheck: one `identify-figure` (the liability is the $12,000 loan balance, not the $280 payment).

**`net-worth.ts`** — id `net-worth`, title "Net worth".
- shortDefinition: "What your household owns minus what it owes — also called household equity."
- fullDefinition must state the equity synonym: net worth is the household's equity, the same concept as shareholder equity in a business (this record covers both, per spec).
- formula: "Assets − liabilities".
- businessContext: identical in form to shareholder equity: assets − liabilities = equity; "building equity" means growing this number.
- commonMisunderstanding: net worth is not cash and not income — it can grow while cash is tight (e.g., paying down a mortgage) and shrink while income is high.
- related: `assets`, `liabilities`, `free-cash-flow`; prerequisites: `assets`, `liabilities`. dataMetricKey: `snapshot:netWorth`.
- personalApplication: metricKey `snapshot:netWorth`, requiresData `["balance-history"]`; interpretationRules: state the figure and its direction; separate owner-created change (your contributions and paydowns) from market movement wherever the engine provides the split — never conflate them (binding product rule).
- knowledgeCheck: one `identify-figure` (assets $260k, liabilities $212k → net worth $48k — matches the Rivera sample) + one `interpretation` (net worth rose while checking balance fell — mortgage paydown moved cash into equity).

**`liquidity.ts`** — id `liquidity`, title "Liquidity".
- shortDefinition: "How quickly your household's money can be used — cash you can spend now versus value that takes time to unlock."
- formula: none at concept level; the lesson's calculation shows PFI's main liquidity gauge: "Liquid assets ÷ monthly essential expenses = emergency runway (months)".
- businessContext: companies fail from illiquidity more often than from having too few assets; analysts track current ratio and quick ratio.
- commonMisunderstanding: wealthy is not the same as liquid — a household rich in home equity can still miss a rent payment; total balance can rise while liquidity weakens if the cash is committed to near-term obligations.
- related: `assets`, `short-term-obligations`, `available-capital`; prerequisites: `assets`. **Note:** `short-term-obligations` and `available-capital` don't exist until Task 4 — ship Task 3 with related = `["assets"]`, add the rest in Task 4. dataMetricKey: `metric:liquid_runway_months`.
- personalApplication: metricKey `metric:liquid_runway_months`, requiresData `["balance-history", "spending-transactions"]`; interpretationRules: express runway in months plainly; below ~1 month state factually with no alarm language; unavailable → name what's missing.
- knowledgeCheck: one `interpretation` (two households, same net worth, one mostly home equity, one with 6 months of cash — who's more liquid and why) + one `which-action` (which raises liquidity: moving investment gains to a savings account vs. buying a car with cash vs. prepaying a year of insurance — the first).

- [ ] **Step 3: Wire into `content/index.ts` and `modules.ts`**

Append to `ALL_CONCEPTS` (after Module 1's five): `assets, liabilities, netWorth, liquidity`. Append to `MODULES`:

```ts
  {
    id: "reading-your-household-balance-sheet",
    title: "Reading Your Household Balance Sheet",
    order: 2,
    conceptIds: ["assets", "liabilities", "net-worth", "liquidity"],
  },
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test src/lib/concepts/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts/
git commit -m "feat(concepts): Module 2 content — reading your household balance sheet

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Module 3 content + glossary-only records (6 concepts)

**Files:**
- Create: `src/lib/concepts/content/debt-pressure.ts` (full lesson), `short-term-obligations.ts`, `financial-flexibility.ts`, `retained-cash.ts`, `capital-allocation.ts`, `available-capital.ts` (glossary-only — **no `lesson` field**)
- Modify: `src/lib/concepts/content/index.ts`, `src/lib/concepts/modules.ts`
- Modify: `src/lib/concepts/content/free-cash-flow.ts`, `savings-rate.ts`, `liabilities.ts`, `liquidity.ts` (restore deferred `relatedConceptIds`)
- Modify: `src/lib/concepts/content.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: final registry — 15 concepts (10 with lessons), 3 modules.

- [ ] **Step 1: Extend the content test (failing first)**

```ts
  it("has Module 3 anchored by the debt-pressure lesson", () => {
    const m3 = MODULES.find((m) => m.id === "financial-pressure-and-flexibility");
    expect(m3?.conceptIds).toEqual([
      "debt-pressure",
      "short-term-obligations",
      "financial-flexibility",
      "retained-cash",
      "capital-allocation",
    ]);
  });

  it("has exactly 15 concepts, 10 with lessons", () => {
    expect(ALL_CONCEPTS).toHaveLength(15);
    expect(ALL_CONCEPTS.filter((c) => c.lesson)).toHaveLength(10);
  });

  it("keeps glossary-only records lesson-free but tappable", () => {
    for (const id of ["short-term-obligations", "financial-flexibility", "retained-cash", "capital-allocation", "available-capital"]) {
      const c = ALL_CONCEPTS.find((x) => x.id === id);
      expect(c?.lesson, id).toBeUndefined();
      expect(c?.shortDefinition, id).toBeTruthy();
      expect(c?.fullDefinition, id).toBeTruthy();
    }
  });
```

Run: `pnpm test src/lib/concepts/content.test.ts` — expected: new tests FAIL.

- [ ] **Step 2: Author the six records**

**`debt-pressure.ts`** — full lesson, id `debt-pressure`, title "Debt pressure".
- shortDefinition: "How much of your revenue is committed to required debt payments."
- formula: "Required debt payments ÷ revenue".
- householdAdaptation: business analysts call the family of measures "debt service" ratios; PFI's Debt burden metric measures loan and credit-card payments as a share of income, with housing measured separately (counted once).
- businessContext: lenders and analysts read debt service against income to judge how much strain existing obligations create — high pressure means less room to absorb surprises.
- commonMisunderstanding: total debt and debt pressure are different — a large mortgage at a low required payment can pressure a budget less than a small card balance at a punishing minimum.
- related: `liabilities`, `short-term-obligations`, `financial-flexibility`, `free-cash-flow`; prerequisites: `liabilities`, `free-cash-flow`. dataMetricKey: `metric:debt_service_ratio`.
- The lesson teaches the four glossary-only Module 3 companions inline: short-term obligations (what's due soon), financial flexibility (room to maneuver), retained cash (the cash you kept), capital allocation (directing free cash flow) — each one sentence with its glossary record carrying the rest.
- personalApplication: metricKey `metric:debt_service_ratio`, requiresData `["income-transactions", "debt-accounts"]`; interpretationRules: state the share plainly; "no debt — nothing to service" is a valid state, reported as such; improvement means the share fell, whether from lower payments or higher revenue — say which.
- knowledgeCheck: one `interpretation` (household A owes $250k mortgage / 12% of revenue in payments; household B owes $8k cards / 22% — who has more debt pressure? B) + one `which-action`.

**Glossary-only records** (no `lesson`; complete every non-lesson field):

- **`short-term-obligations.ts`** — title "Short-term obligations". shortDefinition: "Payments your household is committed to before your next expected income." formula: none. businessContext: "current liabilities" on a balance sheet. commonMisunderstanding: money in your account that's already spoken for isn't really available. related: `liquidity`, `available-capital`, `debt-pressure`. dataMetricKey: `snapshot:nearTermObligations`.
- **`financial-flexibility.ts`** — title "Financial flexibility". shortDefinition: "Your household's room to absorb surprises or seize opportunities without borrowing." formula: none. businessContext: why companies hold cash reserves and credit lines. related: `liquidity`, `free-cash-flow`, `available-capital`. dataMetricKey: `position:cushion`.
- **`retained-cash.ts`** — title "Retained cash". shortDefinition: "The portion of free cash flow your household kept as cash rather than allocating elsewhere." formula: none at record level (it is a component of the savings rate). businessContext: "retained earnings" is the corporate cousin. related: `free-cash-flow`, `savings-rate`, `capital-allocation`. dataMetricKey: `report:savings`.
- **`capital-allocation.ts`** — title "Capital allocation". shortDefinition: "Deciding where your free cash flow goes — cash savings, investments, or debt paydown." formula: none. businessContext: the CEO's most important job, per most investors; households make the same decision every month. related: `free-cash-flow`, `retained-cash`, `savings-rate`. dataMetricKey: omit.
- **`available-capital.ts`** — title "Available capital". shortDefinition: "Cash you can actually deploy: liquid assets minus revolving balances and obligations due before your next income." formula: "Liquid assets − revolving balances − near-term obligations". householdAdaptation: this is PFI's signature derived quantity (the "available financial position") — the base number the personal index, baseline, and waterline are computed from; there is no single corporate equivalent, which is why it keeps its own name (audit ruling, spec findings #6). businessContext: closest cousins are working capital and "dry powder". related: `liquidity`, `short-term-obligations`, `financial-flexibility`. dataMetricKey: `position:availablePosition`.

- [ ] **Step 3: Wire up and restore deferred cross-references**

Append the six to `ALL_CONCEPTS`; append module 3 (order 3, id `financial-pressure-and-flexibility`, title "Financial Pressure and Flexibility", conceptIds as in the test). Restore the deferred `relatedConceptIds`: free-cash-flow → add `retained-cash`, `capital-allocation`; savings-rate → add `retained-cash`, `capital-allocation`; liabilities → add `debt-pressure`; liquidity → add `short-term-obligations`, `available-capital`.

- [ ] **Step 4: Run the tests**

Run: `pnpm test src/lib/concepts/`
Expected: PASS — including registry validation over the full 15-concept graph.

- [ ] **Step 5: Commit**

```bash
git add src/lib/concepts/
git commit -m "feat(concepts): Module 3 + glossary-only records — full 15-concept MVP registry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Cross-engine validation + the renames

**Files:**
- Create: `src/lib/concepts/engine-binding.test.ts`
- Create: `src/lib/concepts/label-consistency.test.ts`
- Modify: `src/lib/financial-engine/metrics.ts` (two `name` strings)
- Modify: `src/app/report/ReportView.tsx` (two labels)
- Modify: `src/lib/financial-engine/report.ts` (narration noun)
- Modify: `src/components/dashboard/HomeDashboard.tsx` (label casing)
- Modify: `src/lib/financial-engine/report.test.ts` (surplus assertions)

**Interfaces:**
- Consumes: `ALL_CONCEPTS` (Task 4 complete registry); `METRICS` from `src/lib/financial-engine/metrics`.
- Produces: a product whose labels match the glossary, guarded by tests.

- [ ] **Step 1: Write the failing engine-binding test**

```ts
// src/lib/concepts/engine-binding.test.ts
import { describe, expect, it } from "vitest";
import { METRICS } from "../financial-engine/metrics";
import { ALL_CONCEPTS } from "./content";

/** PeriodStatement numeric fields (src/lib/financial-engine/report.ts). */
const REPORT_FIELDS = new Set([
  "revenue", "operatingExpenses", "freeCashFlow", "savings", "investments",
  "debtReduction", "ownerCreatedEquity", "indexChange", "indexEnd", "savingsRatePct",
]);
/** DailySnapshot numeric fields (src/lib/financial-engine/types.ts). */
const SNAPSHOT_FIELDS = new Set([
  "liquidAssets", "revolvingBalances", "nearTermObligations", "essentialObligations", "safetyBuffer", "netWorth",
]);
/** Exported functions of src/lib/financial-engine/position.ts. */
const POSITION_FNS = new Set(["availablePosition", "waterline", "cushion"]);

const resolves = (key: string): boolean => {
  const [ns, rest] = key.split(":");
  if (ns === "metric") return METRICS.some((m) => m.id === rest);
  if (ns === "report") return REPORT_FIELDS.has(rest);
  if (ns === "snapshot") return SNAPSHOT_FIELDS.has(rest);
  if (ns === "position") return POSITION_FNS.has(rest);
  return false;
};

describe("concept → engine bindings", () => {
  it("resolves every dataMetricKey and personalApplication.metricKey", () => {
    for (const c of ALL_CONCEPTS) {
      if (c.dataMetricKey) expect(resolves(c.dataMetricKey), `${c.id}: ${c.dataMetricKey}`).toBe(true);
      const pk = c.lesson?.personalApplication?.metricKey;
      if (pk) expect(resolves(pk), `${c.id}: ${pk}`).toBe(true);
    }
  });
});
```

Run: `pnpm test src/lib/concepts/engine-binding.test.ts`
Expected: PASS immediately if Tasks 2–4 used only valid keys — that's fine; it's a permanent drift guard, not a red-first test. If any key fails, fix the content, not the test.

- [ ] **Step 2: Write the failing label-consistency test**

```ts
// src/lib/concepts/label-consistency.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Governance guard (docs/TERMINOLOGY.md): user-visible financial labels must
 * match the canonical glossary. If this test fails, either the rename
 * regressed or a label changed without a glossary ruling.
 */
describe("canonical labels", () => {
  it("report statement uses canonical row labels", () => {
    const src = read("src/app/report/ReportView.tsx");
    expect(src).toContain('label="Free cash flow"');
    expect(src).toContain('label="Owner-created equity"');
    expect(src).not.toContain("Monthly surplus");
    expect(src).not.toContain("Growth you created");
  });

  it("metric registry uses canonical metric names", () => {
    const src = read("src/lib/financial-engine/metrics.ts");
    expect(src).toContain('name: "Free cash flow margin"');
    expect(src).toContain('name: "Typical monthly free cash flow"');
    // Display names must not use "surplus"; stable metric IDS (recurring_surplus) are exempt.
    expect(src).not.toMatch(/name: "[^"]*surplus[^"]*"/i);
  });

  it("report narration never uses 'surplus' as the noun for free cash flow", () => {
    const src = read("src/lib/financial-engine/report.ts");
    expect(src).not.toContain('"surplus"');
  });

  it("dashboard card label matches glossary casing", () => {
    const src = read("src/components/dashboard/HomeDashboard.tsx");
    expect(src).toContain('label="Available capital"');
    expect(src).not.toContain('label="Available Capital"');
  });
});
```

Run: `pnpm test src/lib/concepts/label-consistency.test.ts`
Expected: FAIL on all four tests (old labels still present).

- [ ] **Step 3: Apply the renames**

1. `src/lib/financial-engine/metrics.ts`: `name: "Monthly surplus margin"` → `name: "Free cash flow margin"`; `name: "Typical monthly surplus"` → `name: "Typical monthly free cash flow"`. **Ids unchanged.**
2. `src/app/report/ReportView.tsx`: `label="Monthly surplus"` → `label="Free cash flow"`; `label="Growth you created"` → `label="Owner-created equity"`.
3. `src/lib/financial-engine/report.ts`, `buildManagementCommentary`: delete the `flowNoun` line and change sentence 2 so "free cash flow" is the noun:

```ts
  const fcfVerb = s.freeCashFlow >= 0 ? "produced" : "posted";
  // (flowNoun removed — audit ruling: "surplus"/"shortfall" never stand in for free cash flow)
```

```ts
    `That free cash flow was allocated across ${formatDollars(s.savings)} of retained cash, ${formatDollars(s.investments)} of investment contributions, and ${formatSignedDollars(s.debtReduction)} of debt reduction — ${equityVerb}, with no market appreciation recorded this period.`,
```

4. `src/components/dashboard/HomeDashboard.tsx`: `label="Available Capital"` → `label="Available capital"` (casing only; the audit kept the term).

- [ ] **Step 4: Update the report narration tests**

In `src/lib/financial-engine/report.test.ts`, replace the two surplus/shortfall tests (~lines 239–279) with equivalents asserting the new invariant — keep each test's existing statement-fixture setup lines exactly as they are, changing only the test names and assertions:

```ts
  it("keeps 'free cash flow' as the noun when free cash flow is negative", () => {
    // ...existing negative-FCF fixture setup from the old "shortfall" test...
    expect(commentary.join(" ")).toContain("free cash flow");
    expect(commentary.join(" ")).not.toContain("surplus");
    expect(commentary.join(" ")).toContain("posted");
  });

  it("keeps 'free cash flow' as the noun when free cash flow is positive", () => {
    // ...existing positive-FCF fixture setup from the old "surplus" test...
    expect(commentary.join(" ")).toContain("free cash flow");
    expect(commentary.join(" ")).not.toContain("surplus");
    expect(commentary.join(" ")).toContain("produced");
  });
```

- [ ] **Step 5: Run the full unit suite**

Run: `pnpm test`
Expected: PASS. If any other test asserts an old label (search first: `grep -rn "Monthly surplus\|Typical monthly surplus\|Growth you created" src e2e`), update the assertion to the canonical label — never the label to the assertion. Computed **values** must not change in any test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/concepts/ src/lib/financial-engine/ src/app/report/ src/components/dashboard/
git commit -m "feat(terminology): apply canonical renames + engine-binding and label guards

Monthly surplus → Free cash flow (identical math, one name);
surplus metric names → free-cash-flow names (ids stable);
Growth you created → Owner-created equity; narration noun fixed;
Available capital casing normalized. Zero formula changes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Governance doc + roadmap/decisions/current-phase updates

**Files:**
- Create: `docs/TERMINOLOGY.md`
- Modify: `docs/ROADMAP.md` (insert Phase 4.5; annotate Phase 4)
- Modify: `docs/DECISIONS.md` (append entry #32)
- Modify: `docs/CURRENT_PHASE.md` (new slice status + next priorities)

**Interfaces:**
- Consumes: the shipped registry and renames (Tasks 1–5).
- Produces: governance standard future slices cite.

- [ ] **Step 1: Write `docs/TERMINOLOGY.md`**

Structure (write all sections in full):

```markdown
# PFI Terminology Standard

_The human governance layer for PFI's financial language. The machine-readable
source of truth is `src/lib/concepts/` (typed, tested); this doc records the
standard, the audit, and the rules. Established 2026-07-20 (Academy Slice 1)._

## The rule

**No new user-visible financial label ships without a glossary row** (a concept
record in `src/lib/concepts/content/`, or an explicit ruling here). The words
"surplus", "profit", "disposable income", and "available cash" are never used
interchangeably with defined terms. `src/lib/concepts/label-consistency.test.ts`
enforces the canonical labels mechanically.

## What every term must have

Canonical name · plain-language definition · technical definition · formula ·
household adaptation (when it deviates from the business definition) · business
equivalent · related metrics · display rules · calculation source.
All of these live on the `FinancialConcept` record; this doc doesn't duplicate them.

## Canonical rulings (2026-07-20 audit)

[Copy the full findings table — both "Changes" and "Audited, no change needed" —
verbatim from the spec (docs/superpowers/specs/2026-07-20-academy-slice1-terminology-concepts-design.md),
including the Available-capital correction note.]

## Key canonical definitions

- **Free cash flow** = revenue − operating expenses (household adaptation; disclosed).
- **Savings rate** = retained cash ÷ revenue — NOT (income − spending) ÷ income;
  that is the Free cash flow margin. Any "share of FCF retained" stat is a new
  metric and needs its own row before shipping.
- **Available capital** = liquid assets − revolving balances − near-term
  obligations (PFI's available financial position; signature derived quantity).
- **Owner-created equity** is always kept separate from market appreciation.

## Concept inventory

[15-row table: id · title · module (or "glossary-only") · dataMetricKey · lesson yes/no —
generated by reading `src/lib/concepts/content/index.ts` at authoring time.]
```

- [ ] **Step 2: Update `docs/ROADMAP.md`**

In the Phase 4 section, append to the `⏳` line: remaining Phase 4 surfaces are **deferred until after Phase 4.5** and will be built on the Academy terminology architecture. Then insert between Phase 4 and Phase 5:

```markdown
## Phase 4.5 — Financial Fluency: PFI Academy (MVP)

**The product-priority pivot (2026-07-20, DECISIONS #32):** PFI's core objective now
includes making users financially fluent — teaching the standard language of business
and finance (revenue, operating expenses, free cash flow, liquidity, assets,
liabilities, equity, capital allocation) and reinforcing it through the household's
own data. Model: **Academy teaches the concept → the application applies it →
repetition creates fluency.** Users learn to think like the CFO of their household.
Three connected layers sharing one terminology, calculation, and visual language:
the Household Operating System (existing product — "where do I stand?"), PFI Academy
("what do these terms mean?"), and Contextual Reinforcement ("how does this apply
to my household?"). Mobile-first throughout.

Four slices, each its own spec → plan → implementation cycle:

1. ✅/⏳ **Terminology governance + concept schema** — audit + canonical glossary
   (docs/TERMINOLOGY.md), framework-free `src/lib/concepts/` (15 typed concept
   records: 10 full lessons across 3 modules + 5 glossary-only), approved renames
   applied (spec: docs/superpowers/specs/2026-07-20-academy-slice1-terminology-concepts-design.md).
2. **`FinancialTerm` interaction system** — reusable tappable-term component +
   pre-completion definition sheets, wired into report/dashboard.
3. **Academy home + lesson experience** — lesson template UI, knowledge checks,
   DB-backed progress (Supabase + RLS), unlocked analytical term sheets.
4. **Personalization + reinforcement + analytics** — lessons bound to live
   household data, contextual reinforcement, analytics events → friends-and-family
   testing gate.

Out of MVP scope: video, leaderboards, certifications, complex gamification,
daily-streak pressure, AI-generated lessons without review, investment/tax/
personalized-advice content.

Exit: a level-0 user can complete the three starter modules, every taught term is
tappable where it appears, progress persists, lessons use real household data when
available (clearly labeled otherwise), and the friends-and-family loop —
learn → apply → encounter → retain — is testable end to end.
```

(Adjust the slice-1 status marker to ✅ only in the final task once `pnpm check` is green.)

- [ ] **Step 3: Append DECISIONS.md entry**

```markdown
## 32. 2026-07-20 — Financial-fluency pivot: Academy becomes Phase 4.5, terminology standard established

**Decision:** PFI adds financial fluency as a core product objective (Academy teaches →
application applies → repetition creates fluency), inserted as Phase 4.5 ahead of the
remaining Phase 4 AI surfaces and all later phases. Slice 1 ships the foundation:
a framework-free typed concept registry (`src/lib/concepts/`, 15 concepts, tested),
docs/TERMINOLOGY.md governance, and the terminology audit's renames.
**Alternatives:** Continue Phase 4 surfaces first (rejected: future features would keep
building on inconsistent language); DB-backed CMS for content (rejected for MVP: repo
content gets code review, versioning, and tests; the author is the developer);
rename "Available capital" to "Liquid assets" (rejected during planning — the card
renders availablePosition = liquid − revolving − near-term obligations; the borrowed
label would have been mathematically wrong).
**Key rulings:** "Monthly surplus" and free cash flow were mathematically identical →
one name ("Free cash flow"); savings rate = retained cash ÷ revenue (distinct from FCF
margin); surplus/profit/disposable-income never stand in for defined terms; metric ids
never change in renames.
**Consequences:** every future user-visible financial label requires a glossary row
(mechanically enforced by label-consistency.test.ts); Slices 2–4 (FinancialTerm
system, Academy UI + progress, personalization/reinforcement) follow on this
foundation; remaining Phase 4 surfaces resume after the Academy MVP.
```

- [ ] **Step 4: Update `docs/CURRENT_PHASE.md`**

Update the header line, add a "Completed (this phase — Academy Slice 1: terminology + concepts)" section summarizing Tasks 1–6, and rewrite "Next three priorities" to: (1) Academy Slice 2 — FinancialTerm interaction system (brainstorm → spec → plan); (2) transactional email provider decision (carried over); (3) deploy-time env assertion for server-only vars (carried over). Note the deferral of remaining Phase 4 surfaces to post-Academy. Keep the existing carried-over sections intact.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(terminology): TERMINOLOGY.md governance + Phase 4.5 roadmap insertion + DECISIONS #32

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification

**Files:**
- Modify: `docs/CURRENT_PHASE.md` (test-status section), `docs/ROADMAP.md` (slice-1 marker → ✅)

- [ ] **Step 1: Run the full check**

Run: `pnpm check`
Expected: lint 0 errors (1 pre-existing `AccountSheet.tsx` warning allowed), typecheck clean, **all unit tests pass** (400 baseline + new concepts suites), build succeeds with 20 routes (no new routes in this slice).

- [ ] **Step 2: Run e2e**

Run: `pnpm test:e2e`
Expected: 20/20. If a spec asserts an old label ("Monthly surplus", "Available Capital", "Growth you created"), update the assertion to the canonical label and re-run.

- [ ] **Step 3: Visual verification (mobile first, then desktop)**

Start `pnpm dev`; verify at **390×844 first, then 1280×900**:
1. `/report` — statement rows read "Free cash flow" and "Owner-created equity"; management commentary reads "…of free cash flow. That free cash flow was allocated across…"; no "surplus" anywhere; rows fit at 390px without wrapping badly.
2. `/score` — Cash Flow dimension lists "Free cash flow margin" and "Typical monthly free cash flow"; values identical to pre-rename (names changed, numbers didn't).
3. Dashboard — key-metrics card reads "Available capital"; value unchanged.
Zero console errors on all three screens.

- [ ] **Step 4: Update docs status and commit**

Set the roadmap slice-1 marker to ✅ with the date; record exact test counts in CURRENT_PHASE.md's test-status section (unit total, e2e total, lint/typecheck/build results, visual verification note).

```bash
git add docs/
git commit -m "docs: record Academy Slice 1 verification results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** audit rulings → Task 5; concept schema/types → Task 1; 15 records (10 lessons, 3 modules) → Tasks 2–4; validation suite → Tasks 1, 2, 5 (registry, content, engine-binding, label-consistency); renames → Task 5; TERMINOLOGY.md + roadmap/DECISIONS/CURRENT_PHASE → Task 6; `pnpm check` + mobile-first visual verification → Task 7. Deliberately absent (per spec's out-of-scope): FinancialTerm component, Academy UI, DB migration, progress tracking, analytics, reinforcement.
- **Ordering note:** Tasks 2–3 defer forward `relatedConceptIds` (to concepts created in Task 4) so `validateRegistry` stays green at every commit; Task 4 restores them — this is intentional, not an omission.
- **Type consistency:** `buildRegistry`/`validateRegistry`/`ALL_CONCEPTS`/`MODULES`/`CONCEPT_REGISTRY` names are used identically across Tasks 1–5; metric-key namespace (`metric:`/`report:`/`snapshot:`/`position:`) is identical in types.ts docs (Task 1), content bindings (Tasks 2–4), and the resolver test (Task 5).
