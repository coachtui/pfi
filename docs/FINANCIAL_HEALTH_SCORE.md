# Financial Health Score (PFI Score)

Status: **specified for implementation** (Phase 2). `PFI_SCORE_VERSION = "1.0"`. This document is the formal scoring specification — scoring rules live here, not only in code. The engine implementation must match this document; changes to either require changing both, and methodology changes require a version bump (see Versioning).

## What it is

A 0–900 score measuring **personal financial operating health** — the current condition and direction of a household's finances.

**This is not a credit score and must never be described as one.** It measures neither wealth nor creditworthiness nor personal worth. Never rank users on absolute wealth.

The overall scale stays 0–900 (binding product rule); each dimension is scored 0–100 and the overall score maps eligible dimensions onto 0–900.

## v1 weighted dimensions

Six weighted dimensions. Weights total 100%.

| Dimension | Weight | User-facing question |
|---|---:|---|
| Cash Flow Health | 25% | "Am I consistently spending less than I earn, and is that margin improving or weakening?" |
| Liquidity & Resilience | 20% | "How long could I keep meeting essential obligations if my income stopped or a surprise expense hit?" |
| Debt Health | 20% | "Is my debt affordable, becoming more manageable, and avoiding unnecessary drag?" |
| Stability | 15% | "How predictable is my financial structure, and how vulnerable am I to an income disruption?" |
| Growth | 15% | "Am I consistently building future financial capacity through actions I can control?" |
| Concentration | 5% | "Am I too dependent on one source, institution, asset, or outcome?" |

**Protection is not a weighted component in v1** (see Protection below). **Momentum is not a weighted dimension** — it is a directional overlay (see Momentum below).

## Data-inclusion policy (applies to every windowed metric)

- **Income** = inflows with effective category `income` (override-aware), transfers excluded. Includes one-time/bonus income; irregularity is captured by Stability metrics and flagged in explanations, never silently smoothed.
- **Outflows** = all outflows excluding transfers (`is_transfer`) and investment contributions. Investment contributions are savings (Growth), not spending. Debt payments are outflows (they are real obligations).
- **Refunds/reimbursements** = non-income, non-transfer inflows net against outflows in the same window.
- **Transfers** are excluded from income and spending, with two purposeful exceptions detected from the receiving account: **investment contributions** = transfer inflows into `brokerage`/`retirement` accounts plus non-transfer outflows with effective category `savings`; **debt payments** = transfer inflows into liability accounts (`credit_card`, `mortgage`, `auto_loan`, `student_loan`, `personal_loan`, `other_liability`) plus non-transfer outflows with effective category `debt_payment`. Housing/mortgage outflows categorized `housing` are owned by fixed-cost ratio (Cash Flow) and excluded from the debt-service ratio to avoid double counting — v1 DSR measures non-housing debt service; documented limitation.
- **Business and shared-household expenses**: no supporting data in v1 — treated as ordinary household flows; documented limitation.
- **Windows**: metrics use a trailing 90-day window ending at the as-of date; the "monthly" series is three consecutive 30-day buckets ending at the as-of date (deterministic regardless of calendar alignment). Volatility/consistency metrics require the full 90 days of history (3 complete buckets), else the metric is unavailable (`null`).
- **Eligible liquid assets** = balances in `checking`, `savings`, `money_market` accounts with `include_in_calculations`. Retirement, brokerage, property, and other illiquid or penalty-encumbered assets are **never** auto-treated as liquid.
- **Guards**: income ≤ 0 in the window makes income-denominated metrics unavailable (never ±Infinity). Ratio inputs are clamped to [−100%, +100%] before curving (outlier handling); curve outputs clamp to [0, 100].

## Metric registry (v1)

Every metric entry carries: internal id, plain-language name, technical definition/formula, curve, assumptions, limitations, and interpretation guidance ("How is this calculated?" is answerable per metric). **Scored** metrics affect the score; **explanation-only** metrics appear in explanations and never affect the score.

### Cash Flow Health (25%)

| Metric | Formula | Curve anchor points (input → 0–100) |
|---|---|---|
| Net cash-flow margin (`net_cash_flow_margin`) | (income − spending outflows) / income — spending excludes transfers and investment contributions per the inclusion policy, so the margin is the monthly surplus share | −10%→0 · 0%→35 · 5%→55 · 10%→70 · 20%→90 · ≥30%→100 |
| Fixed-cost ratio (`fixed_cost_ratio`) | essential outflows / income | ≤30%→100 · 40%→85 · 50%→65 · 60%→45 · 75%→20 · ≥90%→0 |
| Expense volatility (`expense_volatility`) | CV of monthly spending outflows | ≤0.10→100 · 0.20→80 · 0.35→55 · 0.50→30 · ≥0.75→0 |

Explanation-only: savings rate (contributions / income — **owned by Growth as `contribution_rate`; shown here as context, scored exactly once**), recurring monthly surplus/deficit (median monthly net), discretionary spending trend, essential vs nonessential burden. (Double-counting audit note: a separately-scored savings rate would duplicate `net_cash_flow_margin` at the level dimension and `contribution_rate` in Growth once spending excludes contributions, so it is not a scored metric.)

**Required core metric:** `net_cash_flow_margin`. If unavailable (e.g. no income in window), the dimension is ineligible.

### Liquidity & Resilience (20%)

| Metric | Formula | Curve anchor points |
|---|---|---|
| Emergency runway (`liquid_runway_months`) | eligible liquid assets / average essential monthly expenses | 0→0 · 1→35 · 3→65 · 6→85 · ≥12→100 |
| Near-term obligation coverage (`obligation_coverage`) | liquid assets / near-term obligations (latest snapshot) | 0→0 · 1×→60 · 2×→85 · ≥3×→100 |
| Cash-balance stability (`cash_drawdown`) | max peak-to-trough drawdown of liquid assets over window | ≤10%→100 · 25%→70 · 50%→35 · ≥75%→0 |

Explanation-only: emergency-fund target coverage (runway restated against a default 3-month essential-expense target until user-defined targets exist — **not scored separately: it is proportional to runway and scoring both would double-count**), revolving-credit dependence (contextual; scored in Debt), overdraft frequency (no data source yet).

**Required core metric:** `liquid_runway_months`.

### Debt Health (20%)

| Metric | Formula | Curve anchor points |
|---|---|---|
| Debt burden (`debt_service_ratio`) | debt-related outflows / income | ≤10%→100 · 20%→80 · 36%→50 · 45%→25 · ≥60%→0 |
| Credit utilization (`revolving_utilization`) | revolving balances / Σ credit limits | 0→100 · 10%→90 · 30%→65 · 50%→40 · 75%→15 · ≥100%→0 (unavailable when no credit limits on file) |
| Interest drag (`weighted_interest_burden`) | Σ(debt balance × APR) / 12 / monthly income — APR as a decimal; account records store percent and are converted at the data boundary | ≤1%→100 · 3%→75 · 6%→45 · 10%→20 · ≥15%→0 (unavailable when rates missing) |
| Revolving trend (`revolving_trajectory`) | Δ revolving balances over window / monthly income | ≤−25%→100 · 0→65 · +25%→35 · ≥+75%→0 |

Not all debt is equal: utilization and interest drag weight high-interest revolving debt hardest by construction (balances × APR); mortgages/secured, lower-rate debt contribute proportionally less per dollar. High-interest debt exposure is explanation-only (it reuses the same balances × rates as interest drag — scoring it too would double-count). Minimum-payment burden and delinquency indicators: future data sources.

**Debt-free rule:** no debt accounts and no debt payments is *known good data*, not missing data → dimension scores 100 with metrics shown as "not applicable — no debt".

**Required:** either debt data present, or the debt-free rule applies (dimension is always eligible when accounts are connected).

### Stability (15%)

| Metric | Formula | Curve anchor points |
|---|---|---|
| Income consistency (`income_consistency`) | CV of monthly income | ≤0.05→100 · 0.15→80 · 0.30→55 · 0.50→30 · ≥0.75→0 |
| Recurring-income coverage (`recurring_income_coverage`) | avg monthly recurring income / avg essential monthly expenses | 0→0 · 0.5×→25 · 1×→60 · 1.5×→85 · ≥2×→100 |
| Irregular-income reliance (`irregular_income_reliance`) | 1 − (recurring income / total income) | ≤10%→100 · 25%→75 · 50%→45 · 75%→20 · ≥90%→0 |

**Fixed-cost ratio is owned by Cash Flow Health and is not scored here** (anti-double-counting). Stability explanations may reference obligation predictability contextually. Income-source concentration is owned by Concentration. Salaried vs self-employed distinctions and compensation-type breakdowns (base/bonus/commission/equity): future — no employment-type data exists yet; documented limitation.

**Required core metric:** `income_consistency`.

### Growth (15%)

| Metric | Formula | Curve anchor points |
|---|---|---|
| Contribution rate (`contribution_rate`) | investment contributions / income | 0%→10 · 5%→55 · 10%→75 · 15%→90 · ≥20%→100 |
| Contribution consistency (`contribution_consistency`) | 30-day buckets with ≥1 contribution / 3 | 0→0 · 1/3→35 · 2/3→70 · 3/3→100 |

Explanation-only: net-worth growth decomposition — **user-driven growth (net contributions + debt principal reduction) is always reported separately from market appreciation and one-time windfalls** (binding product rule). Market movement never directly moves the Growth score in v1: only contribution behavior is scored. Debt-principal reduction: explanation-only until principal/interest splits exist. Goal progress: future (`financial_goals` not implemented).

**Required core metric:** `contribution_rate` (requires income data; a zero value is valid data, not missing data).

### Concentration (5%)

| Metric | Formula | Curve anchor points |
|---|---|---|
| Institution concentration (`institution_concentration`) | largest share of custodial asset balances (bank/brokerage/retirement accounts) at a single institution — non-custodial assets like property are excluded | ≤35%→100 · 50%→80 · 75%→45 · 100%→20 |
| Income-source concentration (`income_source_concentration`) | share of income from top source (normalized description match) | ≤60%→100 · 80%→75 · 100%→55 |

A single income source (one salaried job) is normal and scored gently. Whether that income is *irregular* is owned by Stability (`irregular_income_reliance`) — the concentration curve deliberately does not re-penalize irregularity (anti-double-counting). Single-asset, employer-stock, sector, and variable-rate concentration: future — require investment holdings/loan-terms data that doesn't exist yet. **Never auto-recommend specific securities trades.**

**Eligibility rule:** requires ≥1 month of income data and ≥2 accounts; otherwise `insufficient_data` with reason (e.g. "Investment account data unavailable") — never a definitive score from thin data.

## Metric ownership (anti-double-counting)

The same underlying condition never affects two dimensions' scores unless explicitly documented here.

| Metric | Primary (scored) dimension | Secondary contextual use | Scored twice? |
|---|---|---|---|
| Fixed-cost ratio | Cash Flow Health | Stability explanation (obligation predictability) | No |
| Net cash-flow margin | Cash Flow Health | Growth explanation | No |
| Savings rate (= contribution rate) | Growth (`contribution_rate`) | Cash Flow explanation | No — explanation-only outside Growth |
| Emergency runway | Liquidity | Protection future input | No (emergency-fund coverage is explanation-only restatement) |
| Credit dependence / revolving trend | Debt Health | Liquidity explanation | No |
| Interest drag | Debt Health | High-interest exposure is explanation-only | No |
| Income consistency | Stability | Momentum explanation | No |
| Income-source concentration | Concentration | Stability explanation | No |
| Contribution rate/consistency | Growth | Cash-flow explanation | No |

## Dimension scoring, eligibility, and the overall score

- **Dimension score** = mean of its available scored metrics (equal weights within a dimension in v1), rounded to an integer 0–100.
- **Dimension eligibility**: a dimension is eligible when its required core metric (above) is available (Debt: debt-free rule; Concentration: its eligibility rule). Ineligible dimensions display "insufficient data" with the reason — **never** a fabricated, zero, neutral, average, or predicted score.
- **Overall score** (0–900): requires **Cash Flow Health and Liquidity & Resilience eligible** AND **≥4 of 6 dimensions eligible**. Then `PFI = round(Σ eligible-dimension score × effective weight × 9)`, where effective weights are the configured weights renormalized over eligible dimensions.
  - 6/6 eligible → full score.
  - 4–5 eligible (requirements met) → **provisional** score, labeled with which dimensions are missing and why, e.g. "Your current PFI is provisional because investment concentration data is unavailable."
  - Requirements not met → overall score suppressed; the UI shows eligible dimension scores, what's missing, and what would unlock the score.
- Every score result records: configured weights, effective weights used, excluded dimensions + exclusion reasons, per-dimension and overall confidence, `PFI_SCORE_VERSION`, and the as-of date. (v1 computes at read time — DECISIONS #14 — so this lives in the returned `ScoreBreakdown`, which is also the audit/explanation payload.)

### Score bands (0–900)

| Band | Range |
|---|---|
| Excellent | 750–900 |
| Strong | 640–749 |
| Fair | 500–639 |
| Building | 350–499 |
| Needs attention | 0–349 |

Band labels are descriptive, never shaming.

## Protection (visible, unscored in v1)

Protection matters to resilience but has **no direct data source** in v1 (insurance, estate documents, beneficiary designations are never inferred from bank/investment data). It is displayed separately with status: `not_assessed` (v1 default) · `limited_data` · `needs_review` · `adequately_documented`. It never contributes weight, never fills with a neutral/zero/default score, and its absence never raises or lowers the PFI score. Never state a user lacks insurance or documents unless the user directly confirmed it.

Adding Protection to the weighted score later requires: documented methodology, sufficient direct user inputs, explicit missing-data rules, compliance/legal review, and a scoring-version change.

## Momentum (directional overlay, not a dimension)

Momentum states: `strongly_improving` · `improving` · `stable` · `weakening` · `deteriorating` · `recovering` · `insufficient_history`.

v1 calculation (deterministic): compare the overall score at the as-of date (S₀), 30 days prior (S₃₀), and 60 days prior (S₆₀). Segment deltas d₁ = S₀−S₃₀, d₂ = S₃₀−S₆₀; threshold t = 9 points (1% of scale).

- <60 days of scoreable history → `insufficient_history`
- d₁ > t and d₂ > t → `strongly_improving`; d₁ > t and |d₂| ≤ t → `improving`
- d₁ > t and d₂ < −t → `recovering`
- d₁ < −t and d₂ < −t → `deteriorating`; d₁ < −t and |d₂| ≤ t → `weakening`
- otherwise → `stable`

The score-delta engine's driver attribution supplies the supporting explanation (e.g. "Cash Flow Health and Debt Health improved for three consecutive months while Liquidity stayed stable") and flags one-time-income effects. Momentum never feeds back into the weighted score (no double counting).

## Confidence / data coverage

**Per-dimension confidence**: `high` · `moderate` · `limited` · `insufficient_data`, derived deterministically from: history length (<60d → limited cap, <90d → moderate cap), share of the dimension's metrics unavailable (any optional metric missing, e.g. utilization without credit limits → drop one level), categorization quality (uncategorized share of transactions), unresolved transfers (>5% of in-window transfers on included accounts unpaired → drop one level for Cash Flow/Stability/Growth, whose windowed totals depend on correctly-paired transfers), manually entered data share (>80% of included accounts on the `manual` provider → drop one level for every dimension, applied before the demo cap), and sync freshness (deferred to provider integration — see KNOWN_LIMITATIONS). Demo data caps every dimension at `moderate` with the reason "demo dataset".

**Overall confidence** = the minimum of Cash Flow and Liquidity confidence, dropped one level if any other weighted dimension is ineligible. Displayed with plain-language reasons and a concrete "what would improve accuracy" list.

Missing data lowers **confidence** and (when a required core metric is missing) **eligibility** — never a displayed score value.

## Explanation rules

- Every score change is explainable **deterministically before any AI narration**: previous score, new score, per-dimension change, the specific metrics that moved with signed contributions, one-time events, and data-quality caveats. Comparison period follows the app's shared 30D/90D/1Y/All range picker; the range-start score uses only data that existed at that date (insufficient history for a range → say so, never a fake zero baseline).
- Component (dimension) scores are always visible.
- "How is this calculated?" is answerable at every level (overall → dimension → metric) from the `ScoreBreakdown` alone, with real numbers from this spec's curves.
- Temporary intentional decisions (e.g. a planned large purchase) inform recommendations via the user's stated objective but **never manipulate raw metrics**.

## Consumer-facing language

Internal ids stay precise; user-facing copy is plain-language. Do not use "FCF", EBITDA-style terminology, "owner-created equity", unexplained ratios, or unexplained acronyms in score UI.

| Internal | User-facing |
|---|---|
| `net_cash_flow_margin` | Monthly surplus margin |
| `savings_rate` | Savings rate |
| `liquid_runway_months` | Emergency runway |
| `debt_service_ratio` | Debt burden |
| `weighted_interest_burden` | Interest drag |
| `income_consistency` | Income consistency |
| `contribution_rate` / `contribution_consistency` | Contribution progress |
| `institution_concentration` / `income_source_concentration` | Concentration risk |
| confidence | Score confidence |
| owner-created equity (engine concept) | "Growth you created" / contributions vs market growth |

## Versioning

The scoring formula is versioned (`PFI_SCORE_VERSION`, currently `"1.0"`). Every computed score records the version that produced it. Methodology changes bump the version and never silently rewrite history: keep the original score + version and, where appropriate, a recalculated comparable score with an explanation. (v1 computes scores at read time from immutable-source data — see DECISIONS #14 for how this interacts with versioning until persisted scores arrive with real provider data.)

## Edge cases (normative)

- Zero/negative income in window → income-denominated metrics unavailable; Cash Flow ineligible; overall score suppressed with explanation.
- No debt → Debt Health = 100 via the debt-free rule ("not applicable" metrics, disclosed).
- Single account / no income history → Concentration `insufficient_data`.
- <60 days history → Momentum `insufficient_history`; confidence `limited`; delta vs longer ranges reports insufficient history.
- Annual bonus month → income spike flows into income (never smoothed); Stability captures irregularity; delta explanation flags the one-time event.
- Market-driven investment growth → Growth score unchanged (contributions unchanged); decomposition shows it as market appreciation.
- Corrections (`user_override`) → effective categories recompute metrics on next read; scores restate automatically (documented behavior, consistent with snapshot restatement).

## Test cases (implementation must cover)

Weights total 100%; Protection carries no weight and never affects the score; Momentum absent from weighted aggregation; each dimension scored on representative data; missing concentration/debt/investment data → correct eligibility + effective-weight renormalization (e.g. 5 eligible → weights /0.95); provisional labeling at 4–5 eligible; suppression when Cash Flow or Liquidity ineligible or <4 eligible; debt-free rule; zero-income guard; irregular income & annual bonus; transfers/reimbursements excluded/netted; one-time purchases in delta drivers; market-driven vs contribution-driven growth separation; high-interest revolving debt scoring worse than same-size low-rate debt; fixed-cost ratio scored exactly once; confidence derivation incl. stale/demo data; version recorded in every `ScoreBreakdown`.
