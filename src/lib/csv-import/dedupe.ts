import type { DedupeResult, ExistingTxn, NormalizedRow } from "./types";

const foldDescription = (d: string) => d.trim().toLowerCase().replace(/\s+/g, " ");

/** Canonical duplicate identity: account + date + amount + direction + folded description. */
export function dedupeKey(
  accountId: string,
  t: { postedDate: string; amount: number; direction: string; description: string },
): string {
  return [accountId, t.postedDate, t.amount.toFixed(2), t.direction, foldDescription(t.description)].join("|");
}

/** Split rows into fresh vs duplicates (vs the target account's existing
 * transactions and vs earlier rows in the same file). Duplicates are
 * reported, never silently dropped — the preview lists them. */
export function markDuplicates(
  rows: NormalizedRow[],
  accountId: string,
  existing: ExistingTxn[],
): DedupeResult {
  const seen = new Set(
    existing.filter((t) => t.accountId === accountId).map((t) => dedupeKey(accountId, t)),
  );
  const fresh: NormalizedRow[] = [];
  const duplicates: NormalizedRow[] = [];
  for (const r of rows) {
    const key = dedupeKey(accountId, r);
    if (seen.has(key)) duplicates.push(r);
    else { seen.add(key); fresh.push(r); }
  }
  return { fresh, duplicates };
}
