# Essential-from-Category Score Unlock — Design

_Date: 2026-07-22 · Slice A of the essential-flag / categorization work · Branch: `essential-from-category`_

## Problem

A motivated user linked three accounts and the **PFI score (0–900)** still reports
"not available yet." The **Personal Index** renders fine — only the health score is
suppressed. Root cause is a latent gap, not a data-volume problem:

- `computeScore` (`scoring.ts`) hard-suppresses the entire score unless **both**
  required metrics are available: `net_cash_flow_margin` (cash_flow) **and**
  `liquid_runway_months` (liquidity).
- `liquid_runway_months` returns `unavailable: "No essential expenses recorded in
  the last 90 days"` whenever `totals.essential <= 0` (`metrics.ts`).
- `totals.essential` only accumulates transactions whose raw `essential` boolean is
  `true` (`metric-inputs.ts`: `if (t.essential === true) …`).
- The `essential` flag is written **only** by demo seed data. The override system
  (`TransactionOverride` = `{ category?, description? }`, `overrides.ts`) cannot set
  it, and the transaction editor (`TransactionSheet`) cannot set it.

**Consequence:** for any imported or manually entered transaction, `essential` is
permanently `null`, so a real user has **no path through the UI to unlock the
score.** This is effectively a bug: the score gates on a field with no input.

## Key insight

The taxonomy already encodes essentialness. `category` and `essential` are currently
disconnected — the engine comment even calls category "display/report grouping" only.
Deriving `essential` from `category` deterministically unlocks the score the moment a
transaction is *categorized* (which the existing category `<select>` already
supports), keeps all calculation deterministic (binding rule: "deterministic code
calculates; AI only narrates"), and reserves AI for *suggesting categories a human
confirms* — a later slice (B), not this one.

## Scope

**In scope (A):** deterministic `category → essential` derivation feeding the score.
Invisible plumbing — no new UI.

**Out of scope (deferred to B):** AI-assisted categorization, a categorization review
UI, and a per-transaction manual `essential` override (extending `TransactionOverride`
+ editor toggle). B rides on A's foundation and gets its own spec.

## Design

### 1. The mapping

Add `essentialForCategory(category: string | null): boolean` beside the taxonomy in
`src/lib/config/categories.ts` (framework-free; the engine may import it directly —
`config/categories.ts` has no React/Next imports, preserving the engine's
extractability rule).

| Essential by default | Non-essential by default |
|---|---|
| `housing`, `utilities`, `insurance`, `groceries`, `health`, `debt_payment`, `transport` | `dining`, `shopping`, `discretionary`, `savings`, `other` |

- `transport` → **essential** (decided 2026-07-22: commuting is must-pay; rideshare
  edge cases wait for B's manual override).
- `savings` → non-essential and moot: `metric-inputs` already routes `savings`
  outflows to `contributions` and `continue`s before the essential accumulator.
- `income` → not applicable (inflow; never reaches the essential accumulator).
- `other` / `null` → **false** (conservative; matches the existing "unflagged spending
  counts as non-essential" assumption in `fixed_cost_ratio`).

### 2. The single call-site change

`src/lib/financial-engine/metric-inputs.ts`, in the window-transaction loop:

```diff
- if (t.essential === true) bucket.essential += t.amount;
+ if (t.essential ?? essentialForCategory(t.category)) bucket.essential += t.amount;
```

Semantics: an explicit `essential` flag (demo data now, manual override in B) **wins**;
`null` derives from the effective category. No other engine site reads the raw flag for
accumulation.

### 3. Why re-categorization flows through

The score pipeline builds `ScoreTransactionInput` from `applyOverride(...)` and passes
the **override-applied** `category` (`queries.ts:170`, `:242`). Deriving essential from
`t.category` inside `buildMetricInputs` therefore means a user re-categorizing a
transaction (e.g. `other → housing`) automatically flips its essential contribution —
no new override plumbing required in A. (`applyOverride` still leaves `essential`
untouched; that extension belongs to B.)

## Data flow

```
raw txn (essential=null, category="housing")
  → applyOverride → effective category "housing"   [queries.ts]
  → buildMetricInputs: essential ?? essentialForCategory("housing") = true
  → totals.essential > 0
  → liquid_runway_months available  → liquidity eligible
  → net_cash_flow_margin available  → cash_flow eligible
  → requiredOk = true → score no longer suppressed
```

## Consequences & binding-rule obligations

- **Versioning:** bump `PFI_SCORE_VERSION` (`score-types.ts`). This changes computed
  values for existing users; "methodology changes never silently rewrite history."
- **Normative doc:** add the category→essential mapping to
  `docs/FINANCIAL_HEALTH_SCORE.md` (the source of truth the code cites).
- **Decision log:** add a `DECISIONS.md` entry. Chosen: category-derived essential.
  Alternatives rejected: (a) manual per-txn flag as the *only* path — too much user
  effort, and it left the score unreachable; (b) AI-set essential flag — puts AI
  directly on a score input, violating "deterministic calculates, AI narrates."
- **Known limitations:** update the existing essential/recategorization entry in
  `KNOWN_LIMITATIONS.md`, and add the honest note below.

### Honest limitation (record, don't hide)

CSV import defaults outflows to category `"other"` (`normalize.ts:103`), which is
non-essential. After A, a fresh import still needs its rent/utilities/groceries
**categorized** before the score unlocks. A removes the *impossible* gate and creates a
real path via the existing editor; reducing the manual categorization effort is exactly
what slice B (AI-assisted categorization + human verify) is for.

## Testing

- `categories.test.ts` — unit-test `essentialForCategory` across every category plus
  `null`.
- `metric-inputs.test.ts` — a categorized-but-unflagged (`essential: null`) dataset
  produces `totals.essential > 0`; an explicit `essential: false` on an
  essential-category row still wins (flag beats derivation).
- `score-pipeline.test.ts` — a dataset that is suppressed today (categorized outflows,
  all `essential: null`) yields a non-suppressed (`provisional` or `full`) score after
  the change.
- Regression: existing demo-data score tests must still pass unchanged (demo rows set
  both category and matching essential, so derivation is a no-op for them) — if any
  snapshot value shifts, that's a signal the map disagrees with a seed flag; reconcile
  in the seed, not the map.

## Rollout

Pure recomputation on next snapshot/score rebuild; no migration. Existing users with
categorized-but-unflagged data will see their score appear or shift on next
recompute — acceptable and desired, and covered by the version bump.
