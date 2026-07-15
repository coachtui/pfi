/** Pure positioning math for chart adornments. No React, fully unit-tested. */

export function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** Horizontal fraction (0..1) of point `index` across `count` evenly spaced points. */
export function markerXFraction(index: number, count: number): number {
  if (count <= 1) return 0.5;
  return index / (count - 1);
}

/**
 * Vertical label positions (percent from top) for values on a shared axis
 * rail: max maps to 0, min to 100. Labels closer than `minGapPct` are nudged
 * downward in value order so they stay at least `minGapPct` apart when space
 * allows; if the resulting span overflows 0–100%, positions are compressed
 * back into range and can end up closer than `minGapPct`, down to a 0.01
 * floor — so labels can still touch when the span can't fit. Nulls pass
 * through.
 */
export function railPositions(
  values: Array<number | null>,
  min: number,
  max: number,
  minGapPct: number,
): Array<number | null> {
  const span = max - min;
  const raw = values.map((v) =>
    v === null ? null : span === 0 ? 50 : clampPercent(((max - v) / span) * 100),
  );
  const indexed = raw
    .map((pct, i) => ({ pct, i }))
    .filter((x): x is { pct: number; i: number } => x.pct !== null)
    .sort((a, b) => a.pct - b.pct);
  for (let k = 1; k < indexed.length; k++) {
    if (indexed[k].pct - indexed[k - 1].pct < minGapPct) {
      indexed[k].pct = indexed[k - 1].pct + minGapPct;
    }
  }
  const last = indexed[indexed.length - 1];
  if (last && last.pct > 100) {
    const overflow = last.pct - 100;
    for (const item of indexed) item.pct = Math.max(0, item.pct - overflow);
    for (let k = 1; k < indexed.length; k++) {
      if (indexed[k].pct <= indexed[k - 1].pct) {
        indexed[k].pct = Math.min(100, indexed[k - 1].pct + 0.01);
      }
    }
  }
  const out: Array<number | null> = [...raw];
  for (const { pct, i } of indexed) out[i] = pct;
  return out;
}

/** English ordinal formatting: 87 → "87th", 72 → "72nd", 11 → "11th". */
export function formatOrdinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  const suffix =
    rem100 >= 11 && rem100 <= 13 ? "th"
    : rem10 === 1 ? "st"
    : rem10 === 2 ? "nd"
    : rem10 === 3 ? "rd"
    : "th";
  return `${n}${suffix}`;
}
