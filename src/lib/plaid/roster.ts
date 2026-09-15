/**
 * Account-roster reconciliation (spec §5 step 5, acceptance criterion §13.1).
 * Pure. Fed by `/accounts/get` — the complete list of accounts the Item
 * currently shares — never by `/transactions/sync`'s partial `accounts`.
 *
 * - Plaid account not in PFI            → create (roster_status 'shared')
 * - In both, PFI archived as unshared    → unarchive ("reappeared")
 * - In both, active                      → keep (refresh display fields)
 * - PFI plaid account absent from Plaid  → archive as 'unshared' (history kept)
 *
 * `closed` is reserved for a future signal; Slice 1 never emits it.
 */
import type { MappedAccount } from "./map-account";
import type { PfiAccount, PlanAccountOp, RosterAudit } from "./types";

export interface RosterPlan {
  ops: PlanAccountOp[];
  audit: RosterAudit[];
}

export function reconcileRoster(plaidAccounts: MappedAccount[], pfiAccountsForItem: PfiAccount[], now: string): RosterPlan {
  const ops: PlanAccountOp[] = [];
  const audit: RosterAudit[] = [];
  const byExternal = new Map(pfiAccountsForItem.filter((a) => a.externalAccountId).map((a) => [a.externalAccountId as string, a]));
  const seen = new Set<string>();

  for (const p of plaidAccounts) {
    seen.add(p.externalAccountId);
    const existing = byExternal.get(p.externalAccountId);
    const fields = {
      external_account_id: p.externalAccountId,
      type: p.type,
      display_name: p.displayName,
      institution: p.institution,
      mask: p.mask,
      credit_limit: p.creditLimit,
    };
    if (!existing) {
      ops.push({ op: "create", ...fields, roster_status: "shared" });
      audit.push({ external_account_id: p.externalAccountId, change: "created", at: now });
    } else if (existing.archivedAt !== null && (existing.rosterStatus === "unshared" || existing.rosterStatus === "closed")) {
      ops.push({ op: "unarchive", ...fields, roster_status: "shared" });
      audit.push({ external_account_id: p.externalAccountId, change: "reappeared", at: now });
    } else {
      // Active (or user-archived: the user's archive choice is respected; only
      // roster-driven archives are undone by a reappearance).
      ops.push({ op: "keep", ...fields });
    }
  }

  for (const a of pfiAccountsForItem) {
    if (!a.externalAccountId || seen.has(a.externalAccountId)) continue;
    if (a.archivedAt !== null) continue; // already archived (by roster or by the user) — nothing to do
    ops.push({ op: "archive", external_account_id: a.externalAccountId, roster_status: "unshared" });
    audit.push({ external_account_id: a.externalAccountId, change: "unshared", at: now });
  }

  return { ops, audit };
}
