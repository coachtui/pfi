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

## Contributions vs market appreciation

Not yet separated (no investment holdings data in phase 1). When investment accounts arrive, the index decomposition must separate contributions, withdrawals, market appreciation, debt reduction, and retained cash so owner-created equity can be reported honestly. Tracked in ROADMAP Phase 2/7.
