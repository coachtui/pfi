import type { ExistingTxn, NormalizedRow, TransferPair } from "./types";

export const TRANSFER_MAX_DAY_GAP = 3;
const MS_PER_DAY = 86_400_000;

export function dayGap(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY);
}

/** Conservative transfer pairing. A batch is always a single account's CSV,
 * so the other side is always an existing transaction on a different account
 * (importing the counterpart account's CSV later pairs against this batch via
 * this same path). Pairs are recorded on the new row only — existing rows are
 * never mutated (source-column immutability). */
export function detectTransfers(
  rows: NormalizedRow[],
  targetAccountId: string,
  existing: ExistingTxn[],
): TransferPair[] {
  const candidates = existing.filter(
    (t) => t.accountId !== targetAccountId && t.transferPairId === null,
  );
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const r of [...rows].sort((a, b) => a.line - b.line)) {
    const match = candidates
      .filter(
        (t) =>
          !used.has(t.id) &&
          t.direction !== r.direction &&
          t.amount === r.amount &&
          dayGap(t.postedDate, r.postedDate) <= TRANSFER_MAX_DAY_GAP,
      )
      .sort(
        (x, y) =>
          dayGap(x.postedDate, r.postedDate) - dayGap(y.postedDate, r.postedDate) ||
          (x.id < y.id ? -1 : 1),
      )[0];
    if (match) {
      used.add(match.id);
      pairs.push({ line: r.line, existingId: match.id });
    }
  }
  return pairs;
}
