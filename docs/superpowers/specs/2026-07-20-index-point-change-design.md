# Index-Point Change Display ("% Today" → points) — Design

_Date: 2026-07-20. Status: approved by owner (display format and approach chosen interactively)._

## Problem

The dashboard's "Today" stat under the Personal Index level shows the day-over-day change as a
percentage of the index level (`% Today`). Percent-of-index-level reads misleadingly large or
small depending on where the index sits relative to its scale — the magnitude is an artifact of
the index's current level, not of how much actually changed. Recorded in KNOWN_LIMITATIONS and
"Decisions needed" in CURRENT_PHASE.md.

Additionally, the current calculation (`todayChangePct` in
`src/components/dashboard/HomeDashboard.tsx`) lives inside a React component, violating the
binding rule that no financial formula lives in a component — all calculations belong in
`src/lib/financial-engine/`.

## Decision

Switch the primary display to **index-point change with the percent retained in parentheses**,
stock-ticker style:

```
104.2
+1.3 (+1.2%) Today
```

Owner chose points-with-percent over points-only ("+1.3 pts") and bare points ("+1.3").

## Design

### Engine (`src/lib/financial-engine/`)

New pure, framework-free, tested helper:

```ts
indexDayChange(latest: number, previous: number | undefined): { points: number | null; pct: number | null }
```

- `points` = `latest − previous`; `null` when `previous` is undefined (fewer than two points).
- `pct` = `((latest − previous) / |previous|) × 100`; `null` when `previous` is `0` or
  undefined (no divide-by-zero, no fake `0.0%`).
- Lives in `src/lib/financial-engine/indexing.ts` (the existing index-math module), tested in
  `indexing.test.ts`; no React/Next imports.

### Formatting (`src/lib/financial-engine/format.ts`)

New `formatSignedPoints(n: number): string` → `"+1.3"` / `"−0.4"` — one decimal, true
minus-sign character, matching `formatSignedPercent`'s style and the index level's `toFixed(1)`
precision.

### Display (`src/components/dashboard/HomeDashboard.tsx`)

- Replace the inline `todayChangePct` computation with a call to `indexDayChange`.
- Render `{formatSignedPoints(points)} ({formatSignedPercent(pct)}) Today`.
- When `pct` is `null`, omit the parenthetical entirely.
- When `points` is `null` (single data point), fall back to the current behavior of treating the
  change as `0` for display — i.e. `+0.0 Today`.
- Positive/negative tone classes keyed off `points` (sign + color pairing preserved — never
  color alone).
- The existing "Personal Index" Info tooltip is unchanged; the stat's meaning (day-over-day) is
  unchanged, only its units.

### Out of scope

- Data page cohort trend cards (`t.changePct`) — genuine percentage metrics, stay percent.
- ScoreView's local `signedPoints` — integer score points, different unit; untouched.
- Any change to index math or snapshots.

## Testing

- Unit tests for `indexDayChange`: normal case, `previous === 0`, `previous` undefined.
- Unit tests for `formatSignedPoints`: positive, negative, zero.
- `pnpm check` green.
- Visual verification in browser at ~390px and desktop widths.

## Documentation updates (same slice)

- KNOWN_LIMITATIONS: remove/resolve the `% Today` entry.
- DECISIONS.md: record decision (percent-of-index distortion, alternatives considered:
  points-only with "pts" suffix, bare points, points+percent; chose points+percent).
- CURRENT_PHASE.md: mark priority #3 and the "Decisions needed" `% Today` item resolved.
