import { createHash } from "node:crypto";
import { dedupeKey } from "@/lib/csv-import/dedupe";
import type { ExistingTxn, NormalizedRow } from "@/lib/csv-import/types";

export function fileSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function statementTransactionFingerprint(
  accountId: string,
  row: NormalizedRow & { referenceNumber?: string | null },
  periodEnd?: string | null,
): string {
  return [
    dedupeKey(accountId, row),
    row.referenceNumber?.trim().toLowerCase() ?? "",
    periodEnd ?? "",
  ].join("|");
}

export function likelyDuplicateTransaction(
  accountId: string,
  row: NormalizedRow,
  existing: ExistingTxn[],
): ExistingTxn | null {
  const key = dedupeKey(accountId, row);
  return existing.find((t) => t.accountId === accountId && dedupeKey(accountId, t) === key) ?? null;
}
