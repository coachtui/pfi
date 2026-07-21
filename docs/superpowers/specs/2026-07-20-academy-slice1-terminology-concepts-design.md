# PFI Academy — Slice 1: Terminology Governance + Concept Schema

_Design spec, 2026-07-20. Brainstormed and approved in session; implements the first slice of the Financial Fluency product pivot._

## Context: the product pivot

PFI is pivoting to make **financial fluency a core product objective**, not just financial measurement. The product model:

> **Academy teaches the concept. The application applies it. Repetition creates fluency.**

PFI should teach users to think like the CFO of their household, using the standard language of business and investing (revenue, operating expenses, free cash flow, liquidity, assets, liabilities, equity, capital allocation) — never renaming or dumbing down established terms. The learning layer moves **earlier in the roadmap**: an Academy MVP ships before the remaining advanced features (forecasting, scenarios, rankings depth), so the product can be friends-and-family tested as a complete, understandable experience.

Three connected layers:

1. **Household Operating System** — the existing product (dashboard, index, baseline, waterline, score, reports, data views). Answers: *where does my household stand?*
2. **PFI Academy** — a structured curriculum teaching financial terminology and concepts. Answers: *what do these numbers and terms mean?*
3. **Contextual Reinforcement** — the application reinforces completed concepts through metric cards, reports, commentary, and AI explanations. Answers: *how does this apply to my household?*

The Academy and the operating product must share terminology, calculations, visual language, and user data — one product, not two.

## Slice decomposition (approved)

The Academy MVP is four shippable slices, each with its own spec → plan → implementation cycle:

| Slice | Scope | Depends on |
|---|---|---|
| **1 (this spec)** | Terminology audit + canonical glossary + concept schema + author 14 concept records (10 full lessons) + apply approved renames | — |
| 2 | Reusable `FinancialTerm` interaction system + basic (pre-completion) term detail sheets, wired into report/dashboard | 1 |
| 3 | Academy home + lesson experience + knowledge-check UI + DB-backed progress tracking (Supabase + RLS) + unlocked term sheets | 1, 2 |
| 4 | Personalized calculation blocks bound to live household data + contextual reinforcement + analytics events → friends-and-family testing | 1–3 |

Mobile-first throughout (design and verify at ~390px before desktop), per project UX rules.

## Slice 1 goals

1. Every user-visible financial label in the product resolves to exactly one canonical term with one canonical formula.
2. A framework-free, typed, tested concept/content system exists (`src/lib/concepts/`) holding the glossary and the first ~14 concepts, built to expand to a much larger curriculum.
3. The live product is renamed to match the glossary — Slice 2 wires interactivity into an already-consistent surface.
4. A governance standard (`docs/TERMINOLOGY.md`) prevents future drift.

**No new UI ships in Slice 1.** No `FinancialTerm` component, no Academy screens, no DB migration, no progress tracking, no analytics events, no reinforcement engine.

## Terminology audit — findings and approved resolutions

Principle: **use the real financial term everywhere; plain language belongs in definitions, not labels.**

Key finding: the report's "Monthly surplus" row and its prose "free cash flow" are **mathematically identical** — both render `report.ts`'s `freeCashFlow = revenue − operatingExpenses`. The word "surplus" currently means 2–3 different things across the product.

### Changes (approved)

| # | Today | Where | Resolution |
|---|---|---|---|
| 1 | "Monthly surplus" row renders `freeCashFlow` | `src/app/report/ReportView.tsx:123` | Rename row to **"Free cash flow"** |
| 2 | "Monthly surplus margin" = (income − spending) ÷ income | `src/lib/financial-engine/metrics.ts` (`net_cash_flow_margin`) | Rename to **"Free cash flow margin"** (id unchanged — ids are stable) |
| 3 | "Typical monthly surplus" (median income − spending) | `metrics.ts` (`recurring_surplus`) | Rename to **"Typical monthly free cash flow"** (id unchanged) |
| 4 | Narration uses "surplus"/"shortfall" as the noun for FCF | `src/lib/financial-engine/report.ts` (`flowNoun`) | Rephrase so **"free cash flow"** is the noun; surplus/shortfall may survive only as a plain adjective, never as a metric name |
| 5 | "Growth you created" row vs "owner-created equity" prose | `ReportView.tsx:128` vs `report.ts` narration | Standardize row label to **"Owner-created equity"** |
| 6 | "Available Capital" dashboard card (value = liquid assets) | `src/components/dashboard/HomeDashboard.tsx:188` | Rename to **"Liquid assets"** — the exact balance-sheet term Module 2 teaches |
| 7 | AI prompt/system text referencing any old label | `src/lib/ai/prompts.ts` (checked: currently only "owner-created equity", already canonical) | Sweep and align with glossary during implementation |

### Canonical definitions (approved)

- **Free cash flow (household)** = revenue − operating expenses. Disclosed as a household adaptation: the strict corporate definition is operating cash flow − capital expenditures; the household form is closer to "cash available after running the household."
- **Savings rate** = retained cash ÷ revenue. **Formula and name kept as-is** (`report.ts` `savingsRatePct`). Genuinely distinct from FCF margin, because free cash flow can also be allocated to investment contributions and debt reduction. The lesson's "common misunderstanding" section teaches exactly this distinction. Any future "share of FCF retained as cash" stat is a *different* metric and must get its own glossary row before shipping.
- **Owner-created equity** — kept; already separates owner-created equity from market appreciation per binding product rules.

### Audited, no change needed

- Metric registry (18 metrics): "Essential-cost share", "Spending steadiness", "Emergency runway", "Near-term bill coverage", "Cash-balance stability", "Debt burden", "Credit utilization", "Interest drag", "Card-balance direction", "Income consistency", "Reliable-income coverage", "One-off income reliance", "Contribution rate", "Contribution consistency", "Institution concentration", "Income-source concentration" — consistent, no collisions. Only the two "surplus" metrics change (#2, #3).
- Report rows: "Revenue", "Operating expenses", "Savings (retained cash)", "Investments (contributions)", "Debt reduction", "Market appreciation", "Index movement", "Savings rate".
- Dashboard cards: "Obligations" (maps to the short-term-obligations concept), "Cushion" (waterline concept), "Momentum".
- Score screen labels ("Score dimensions", confidence labels, etc.) — structural, not financial terms.

No metric **formula** changes anywhere in this slice. This is a naming audit; every computed value stays bit-identical.

## Concept system — `src/lib/concepts/`

New framework-free module (same extraction rule as `financial-engine` and `demo-data`: **no React/Next imports**, fully tested, extractable to a package later).

### Types

```ts
// src/lib/concepts/types.ts
export type ConceptId = string; // stable kebab-case slug, e.g. "free-cash-flow"

export interface FinancialConcept {
  id: ConceptId;                    // slug IS the id — one identifier
  title: string;                    // canonical name, e.g. "Free cash flow"
  shortDefinition: string;          // one sentence; the pre-completion tap definition
  fullDefinition: string;
  whyItMatters: string;
  formula?: string;                 // display string, e.g. "Revenue − operating expenses"
  householdAdaptation?: string;     // REQUIRED when formula differs from the strict business definition
  businessContext?: string;         // how businesses/investors use the term
  commonMisunderstanding?: string;
  relatedConceptIds: ConceptId[];
  prerequisiteConceptIds: ConceptId[];
  dataMetricKey?: string;           // must resolve to a metric-registry id or report field (test-enforced)
  status: "draft" | "published" | "archived";
  lesson?: Lesson;                  // absent = glossary-only record
}

export interface Module {
  id: string;
  title: string;
  order: number;
  conceptIds: ConceptId[];          // lesson order = array order
}
```

Deliberate deviations from the original sketch (approved):

- `id`/`slug` merged — two identifiers for one record invites drift.
- `moduleId`/`lessonOrder` moved **off** the concept onto the module — the module owns sequencing, so reordering is one array edit, and a concept can later appear in more than one module.
- `householdAdaptation` added as the enforced home of "this differs from the corporate definition" disclosures.

### Lesson template (the 10-part structure, typed)

```ts
export interface Lesson {
  intro: string;                     // 1. plain-language, assumes zero prior knowledge
  standardTerm: string;              // 2. the real terminology, incl. how business/investing uses it
  whyItMattersExtended?: string;     // 3. lesson may extend concept.whyItMatters
  calculation?: { formula: string; walkthrough: string };   // 4.
  genericExample: string;            // 5. sample household, clearly labeled as sample
  personalApplication?: {            // 6–7. a BINDING, not prose — no literal dollar figures in content
    metricKey: string;               // which engine value slots in
    interpretationRules: string;     // how renderers frame positive/negative/strengthening/weakening/unavailable
    requiresData: DataRequirement;   // what must exist; otherwise sample-household fallback
  };
  commonMisunderstanding: string;    // 8.
  knowledgeCheck: KnowledgeCheck[];  // 9. one or two items max (test-enforced)
  reinforcementPreview: string;      // 10. where the concept appears throughout PFI
}

export type KnowledgeCheck =
  | { kind: "interpretation";  prompt: string; choices: string[]; correctIndex: number; explanation: string }
  | { kind: "identify-figure"; prompt: string; choices: string[]; correctIndex: number; explanation: string }
  | { kind: "which-action";    prompt: string; choices: string[]; correctIndex: number; explanation: string };
```

Three check kinds only, all single-tap multiple choice — no long quizzes, no memorization. The "apply it to your household" interaction style needs live data and belongs to Slice 3's renderer via `personalApplication`. `explanation` teaches on both wrong and right answers.

`DataRequirement` is a small enum/union naming what household data must exist (e.g. `"income-transactions"`, `"balance-history"`, `"debt-accounts"`) — exact members decided at implementation from what the engine can actually answer.

### Layout

```
src/lib/concepts/
  types.ts        — the types above
  registry.ts     — lookup + validation helpers (byId, published, forModule, …)
  modules.ts      — the 3 MVP modules
  content/        — one file per concept (14 files)
    revenue.ts
    operating-expenses.ts
    cash-flow.ts
    free-cash-flow.ts
    savings-rate.ts
    assets.ts
    liabilities.ts
    net-worth.ts            (covers net worth / household equity as one concept)
    liquidity.ts
    debt-pressure.ts
    short-term-obligations.ts   (glossary-only)
    financial-flexibility.ts    (glossary-only)
    retained-cash.ts            (glossary-only)
    capital-allocation.ts       (glossary-only)
```

Expansion path (the curriculum will grow well beyond the MVP): add a content file + one module-array entry. Nothing is hardcoded to "3 modules of 5"; modules are data.

### Modules (MVP)

1. **How Your Household Operates** — revenue, operating expenses, cash flow, free cash flow, savings rate.
2. **Reading Your Household Balance Sheet** — assets, liabilities, net worth (incl. household equity), liquidity.
3. **Financial Pressure and Flexibility** — debt pressure (full lesson), teaching short-term obligations, financial flexibility, retained cash, and basic capital allocation inline; those four exist as glossary-only concept records so any surface can reference them.

Overlapping concepts are not duplicated — prerequisites and `relatedConceptIds` link them (e.g. free cash flow requires revenue + operating expenses; liquidity relates to short-term obligations).

### Authoring standards

- Intro sections assume **zero** prior financial knowledge (level-0 audience).
- One consistent fictional sample household across all concepts, reusing the demo-profile voice; sample figures always labeled as sample.
- Interpretation rules use neutral framings (positive/negative/strengthening/weakening/unavailable) — no moral judgment, no exaggerated praise or alarm, no shame language; same tone rules as `docs/AI_RECOMMENDATION_POLICY.md`.
- Never rename established concepts; household-adjusted definitions are always disclosed via `householdAdaptation`.
- Content never asserts personalized conclusions — personalization is a binding resolved at render time, and users must always be able to tell educational content from calculated-from-their-data content.

### Validation (as unit tests — content is compile-time data)

- Every `dataMetricKey` and every `personalApplication.metricKey` resolves to a real metric-registry id or report field.
- Prerequisite graph is acyclic; all `related`/`prerequisite` ids exist; no duplicate ids; slugs are kebab-case.
- Every module `conceptId` exists; the 10 lesson-bearing concepts each have 1–2 knowledge checks with valid `correctIndex`.
- Every published concept whose `formula` deviates from the business-standard definition has `householdAdaptation`.
- Every glossary title matches the label used in the product for the same value (guards against re-drift; implemented as a mapping table test).

## Governance — `docs/TERMINOLOGY.md`

New doc containing:

1. The terminology standard: each term gets canonical name, plain-language definition, technical definition, formula, household adaptation, business equivalent, related metrics, display rules, calculation source.
2. The full audit findings table (this spec's table, kept current).
3. The governance rule: **no new user-visible financial label ships without a glossary row**, and labels like surplus/profit/disposable income/available cash are never used interchangeably with defined terms.
4. Pointer to `src/lib/concepts/` as the machine-readable source of truth; TERMINOLOGY.md is the human governance layer.

## Applying the renames

Surfaces touched: `metrics.ts` (two `name` fields), `ReportView.tsx` (two row labels), `report.ts` (narration phrasing), `HomeDashboard.tsx` (one card label), plus test/snapshot assertions that reference old names. Metric **ids** never change. AI prompts swept for stale labels.

## Verification & completion criteria

- `pnpm check` green (lint + typecheck + test + build); all existing computed values bit-identical (only name assertions change).
- Visual verification at ~390px then desktop of the three renamed surfaces: report, score screen, dashboard.
- `docs/ROADMAP.md` updated: new phase **"Phase 4.5 — Financial Fluency: PFI Academy (MVP)"** inserted; remaining Phase 4 surfaces (weekly brief, recommendation cards, quarterly report narration) explicitly resume after the Academy MVP, built on the same terminology architecture. `docs/CURRENT_PHASE.md` updated. Pivot recorded in `docs/DECISIONS.md`.
- All 14 concept records authored and `published`, passing the validation suite.

## Out of scope for Slice 1 (deferred to Slices 2–4)

`FinancialTerm` component and term detail sheets (2); Academy home, lesson UI, knowledge-check UI, progress tracking + DB migration + RLS (3); personalization rendering, reinforcement engine, analytics events (4). Also out of the MVP entirely: video, leaderboards, certifications, complex gamification, daily-streak pressure, AI-generated lessons without review, investment/tax/personalized-advice content.
