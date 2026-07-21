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

Principle: **use the real financial term everywhere; plain language belongs in
definitions, not labels.**

Key finding: the report's "Monthly surplus" row and its prose "free cash flow"
were **mathematically identical** — both rendered `report.ts`'s
`freeCashFlow = revenue − operatingExpenses`. The word "surplus" previously meant
2–3 different things across the product.

### Changes (approved and shipped, commit `fe90a4a`)

| # | Today | Where | Resolution |
|---|---|---|---|
| 1 | "Monthly surplus" row renders `freeCashFlow` | `src/app/report/ReportView.tsx:123` | Row renamed to **"Free cash flow"** |
| 2 | "Monthly surplus margin" = (income − spending) ÷ income | `src/lib/financial-engine/metrics.ts` (`net_cash_flow_margin`) | Renamed to **"Free cash flow margin"** (id unchanged — ids are stable) |
| 3 | "Typical monthly surplus" (median income − spending) | `metrics.ts` (`recurring_surplus`) | Renamed to **"Typical monthly free cash flow"** (id unchanged) |
| 4 | Narration used "surplus"/"shortfall" as the noun for FCF | `src/lib/financial-engine/report.ts` (`flowNoun`) | Rephrased so **"free cash flow"** is the noun; surplus/shortfall survive only as a plain adjective, never as a metric name |
| 5 | "Growth you created" row vs "owner-created equity" prose | `ReportView.tsx:128` vs `report.ts` narration | Row label standardized to **"Owner-created equity"** |
| 6 | "Available Capital" dashboard card | `src/components/dashboard/HomeDashboard.tsx:188` | **Label kept** (casing normalized to "Available capital"). Audit correction (2026-07-20): the card renders `availablePosition` = liquid assets − revolving balances − near-term obligations (`position.ts`), **not** liquid assets — renaming it "Liquid assets" would have been mathematically wrong. Instead, "Available capital" became its own glossary-only concept record with that formula, related to liquidity and short-term obligations. It is PFI's signature derived quantity (the index is built from it) and keeps its own name. |
| 7 | AI prompt/system text referencing any old label | `src/lib/ai/prompts.ts` (checked: only "owner-created equity", already canonical) | Swept and aligned with glossary |

### Audited, no change needed

- Metric registry (18 metrics): "Essential-cost share", "Spending steadiness",
  "Emergency runway", "Near-term bill coverage", "Cash-balance stability", "Debt
  burden", "Credit utilization", "Interest drag", "Card-balance direction",
  "Income consistency", "Reliable-income coverage", "One-off income reliance",
  "Contribution rate", "Contribution consistency", "Institution concentration",
  "Income-source concentration" — consistent, no collisions. Only the two
  "surplus" metrics changed (#2, #3).
- Report rows: "Revenue", "Operating expenses", "Savings (retained cash)",
  "Investments (contributions)", "Debt reduction", "Market appreciation", "Index
  movement", "Savings rate".
- Dashboard cards: "Obligations" (maps to the short-term-obligations concept),
  "Cushion" (waterline concept), "Momentum".
- Score screen labels ("Score dimensions", confidence labels, etc.) — structural,
  not financial terms.

No metric **formula** changed anywhere in this audit/rename. This was a naming
audit; every computed value stayed bit-identical.

## Key canonical definitions

- **Free cash flow** = revenue − operating expenses (household adaptation; disclosed).
- **Savings rate** = retained cash ÷ revenue — NOT (income − spending) ÷ income;
  that is the Free cash flow margin. Any "share of FCF retained" stat is a new
  metric and needs its own row before shipping.
- **Available capital** = liquid assets − revolving balances − near-term
  obligations (PFI's available financial position; signature derived quantity).
- **Owner-created equity** is always kept separate from market appreciation.

## Concept inventory

15 concept records (10 with lessons across 3 modules, 5 glossary-only). Module
membership and lesson status are read directly from `src/lib/concepts/modules.ts`
and each content file's `lesson` field.

| id | title | module | dataMetricKey | lesson |
|---|---|---|---|---|
| `revenue` | Revenue | How Your Household Operates | `report:revenue` | yes |
| `operating-expenses` | Operating expenses | How Your Household Operates | `report:operatingExpenses` | yes |
| `cash-flow` | Cash flow | How Your Household Operates | `metric:recurring_surplus` | yes |
| `free-cash-flow` | Free cash flow | How Your Household Operates | `report:freeCashFlow` | yes |
| `savings-rate` | Savings rate | How Your Household Operates | `report:savingsRatePct` | yes |
| `assets` | Assets | Reading Your Household Balance Sheet | — | yes |
| `liabilities` | Liabilities | Reading Your Household Balance Sheet | — | yes |
| `net-worth` | Net worth | Reading Your Household Balance Sheet | `snapshot:netWorth` | yes |
| `liquidity` | Liquidity | Reading Your Household Balance Sheet | `metric:liquid_runway_months` | yes |
| `debt-pressure` | Debt pressure | Financial Pressure and Flexibility | `metric:debt_service_ratio` | yes |
| `short-term-obligations` | Short-term obligations | Financial Pressure and Flexibility | `snapshot:nearTermObligations` | no |
| `financial-flexibility` | Financial flexibility | Financial Pressure and Flexibility | `position:cushion` | no |
| `retained-cash` | Retained cash | Financial Pressure and Flexibility | `report:savings` | no |
| `capital-allocation` | Capital allocation | Financial Pressure and Flexibility | — | no |
| `available-capital` | Available capital | glossary-only (no module) | `position:availablePosition` | no |

10 lesson-bearing concepts across 3 modules; 5 glossary-only records
(`short-term-obligations`, `financial-flexibility`, `retained-cash`,
`capital-allocation` are referenced inline by Module 3's lesson content but carry
no lesson of their own; `available-capital` belongs to no module).
