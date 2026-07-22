# Financial Index Methodology

Version: 1.0 (provisional). Implemented in `src/lib/financial-engine/indexing.ts`.

## Available Financial Position (v1)

The core dollar quantity:

```
Available Financial Position
  = liquid cash and immediately available savings
  − revolving balances
  − obligations due before the next expected income event
```

Implemented as `availablePosition()` in `position.ts`. Modular and configurable; expected to evolve.

## The index

Users see an index that starts near 100, like a stock chart. The naive formula

```
index = current position ÷ starting position × 100
```

breaks when the starting position is negative, zero, or near zero (division blows up or flips sign). Instead we use an **offset-based mapping**:

```
index(v) = 100 + 100 × (v − A) / S
```

where:

- **A (anchor)** = median available position over the first 30 days of history
  (median of full history if fewer than 30 days; 0 with no history).
- **S (scale)** = max(|A|, 25% of the median absolute position across history, $1,000).

### Properties

- **Reduces to the naive formula in the healthy case.** When A > 0 and S = A, `index(v) = v / A × 100` exactly.
- **Handles users starting below zero.** The offset form keeps the index finite and correctly ordered (more negative position → lower index).
- **No distortion near zero.** The scale floor ($1,000 / 25% of median absolute position) prevents a $50 swing from moving the index hundreds of points for users anchored near $0.
- **Missing history.** With no snapshots, method is flagged `insufficient-history`; with short history, the anchor uses the full-history median and is flagged accordingly. The anchor method is stored on `IndexAnchor.method` so the UI can answer "How is this calculated?".
- **One anchor, three lines.** Actual, baseline, and waterline are all mapped through the same anchor, so they are directly comparable on one axis.
- **Restatements.** The anchor is a pure function of history, so a restatement (corrected data) reproduces a full corrected series deterministically. Score/index versioning is planned for Phase 2 (store the methodology version with each stored snapshot).

### Explaining it to users

"Your index starts at 100 at your typical position when you joined. Each point is 1% of your starting scale. 110 means you're about 10% of that scale above where you started."

## Baseline (v1)

Personal expected position from the user's own history: a **trailing 30-day rolling average** of the indexed actual series, requiring at least 7 days of data (`rollingBaseline()`). Deliberately simple and explainable — no ML in phase 1. Future versions may adjust for pay-cycle day, payday timing, recurring bills, and seasonality.

## Waterline (v1)

```
waterline = essential obligations before next income + safety buffer
```

The minimum available position needed to cover near-term essentials plus a user-defined (or system-estimated) buffer. Indexed through the same anchor as the actual line.

**Below baseline ≠ below waterline.** The UI must always distinguish "below your own average" from "unable to cover near-term essentials" (`computeStatus()` keeps them as separate fields).

## Momentum (v1)

Average of the last 7 days of the indexed actual vs the 7 days prior. Within ±1.0 index point is "stable" so daily noise is not labeled a trend (`computeMomentum()`).

## Snapshot derivation (v1)

Implemented in `src/lib/financial-engine/snapshot-builder.ts` (`buildDailySnapshots`). Produces the raw dollar components stored in `daily_snapshots` (DECISIONS.md #8) for every day between a config `startDate` and `endDate`, from a set of accounts and transactions.

**Balance replay is backward.** Only the current balance (as of `endDate`) is known per account. The builder walks dates backward from `endDate` to `startDate`, undoing each day's transactions (`dayDelta`, sign-flipped for liability account types) to reconstruct the balance as of the end of every prior day. `liquid_assets`, `revolving_balances`, and `net_worth` for each date fall out of that day's reconstructed per-account balances.

**Income-date detection.** `buildObligationContext` scans transactions for inflows on liquid accounts categorized `income`, dedupes and sorts the dates, and takes the median gap between consecutive income dates (`DEFAULT_INCOME_GAP_DAYS = 15` when there's no income history to compute a gap from). This median gap stands in for "typical time between paychecks" wherever a forward-looking income date isn't available.

**Obligation windows.** For a given snapshot date, `computeObligations` finds the next income date after it; the obligation window runs from that date to the next income date (or `date + medianGap` if none exists). Every non-transfer outflow from a liquid account inside that window counts toward `near_term_obligations` (and `essential_obligations` when the transaction's `essential` flag is set, or — when the flag is unset — its category is essential-by-default; see `docs/FINANCIAL_HEALTH_SCORE.md`, "Essential-spend classification"); a transfer whose paired leg lands on a liability account counts as a debt payment.

**The 28-day previous-cycle proxy, and its known edge case.** Near the end of known transaction history, a forward-looking window can run past `config.endDate` (no transaction data exists there to sum). When that happens, the window is shifted back by a fixed `PROXY_SHIFT_DAYS = 28` — using the previous income cycle's actual spending as a proxy for the (unobserved) upcoming one, on the assumption that most cycles are close to biweekly/monthly. **This is a single fixed offset, not a search for a cycle length that fits.** If the actual income gap is materially larger than 28 days (an irregular or quarterly income pattern), the shifted window can *still* end after `config.endDate`, and the resulting obligation figure is derived from whatever partial data the shifted window does cover. Recurrence detection (replacing the fixed proxy with a detected cycle length) is deferred to when real recurring-transaction data exists — see KNOWN_LIMITATIONS.

**Liability-vs-asset replay semantics.** `dayDelta` sign-flips liability account transactions before applying them to the balance walk (a payment reduces liability balance; a charge increases it), so `revolving_balances` and `net_worth` stay correct through the backward replay regardless of account type. Non-liability, non-liquid accounts (property, other_asset) still contribute to `net_worth` but not to `liquid_assets`.

## Contributions vs market appreciation

Not yet separated (no investment holdings data in phase 1). When investment accounts arrive, the index decomposition must separate contributions, withdrawals, market appreciation, debt reduction, and retained cash so owner-created equity can be reported honestly. Tracked in ROADMAP Phase 2/7.
