/**
 * Sync-plan reducer (spec §5 step 5). Pure: pages from `/transactions/sync`,
 * the full roster from `/accounts/get`, and the user's current PFI rows go
 * in; the exact jsonb payload `commit_connected_sync` consumes comes out.
 * Nothing here touches the network or the database, so every rule in
 * §5–§8 is unit-tested without Plaid.
 */
import {
  computeDiscrepancy, effectiveAnchor,
  type AccountInput, type AccountType, type BalanceAnchor, type TransactionInput,
} from "@/lib/financial-engine";
import { mapAccount, type MappedAccount } from "./map-account";
import { substantiveChange, toProviderColumns } from "./map-transaction";
import { pairTransfers, type PairCandidate } from "./pair-transfers";
import { reconcileRoster } from "./roster";
import type {
  ExistingTxn, ISODate, ItemStatus, PfiAccount, PlaidAccountShape, PlanAnchor, PlanDelete,
  PlanInsert, PlanPairExisting, PlanUpdate, ProviderColumns, RetractionAudit, SyncPages, SyncPlan, UpdateStatus,
} from "./types";

export interface SyncPlanInput {
  pages: SyncPages;
  /** Complete roster + cached balances from `/accounts/get` — never sync's partial `accounts`. */
  accountsGet: PlaidAccountShape[];
  institutionName: string | null;
  /** Every transaction of the user (all providers) — pairing looks across accounts. */
  existingTxns: ExistingTxn[];
  /** Every account of the user (all providers). */
  pfiAccounts: PfiAccount[];
  /** Every balance anchor of the user, keyed by PFI account id inside. */
  priorAnchors: BalanceAnchor[];
  item: { id: string; status: ItemStatus; historyCompleteAt: string | null; cursor: string | null };
  today: ISODate;
  /** ISO timestamp for audit rows and `observed_at`. */
  now: string;
}

/** Readiness (spec §5 step 4, principle 1). */
export function deriveItemStatus(updateStatus: UpdateStatus, prior: ItemStatus, historyCompleteAt: string | null): ItemStatus {
  switch (updateStatus) {
    case "HISTORICAL_UPDATE_COMPLETE":
      return "connected";
    case "NOT_READY":
    case "INITIAL_UPDATE_COMPLETE":
      return historyCompleteAt ? "connected" : "history_loading";
    default:
      // UNKNOWN: keep what we knew, except that a sync that just succeeded
      // proves a previously broken Item works again.
      if (prior === "login_required" || prior === "error" || prior === "initializing") {
        return historyCompleteAt ? "connected" : "history_loading";
      }
      return prior;
  }
}

/** Anchor date rule (spec §5): institution timestamp's date when Plaid gives one, else today. */
export function anchorDateFor(lastUpdatedDatetime: string | null, today: ISODate): ISODate {
  if (lastUpdatedDatetime && /^\d{4}-\d{2}-\d{2}/.test(lastUpdatedDatetime)) return lastUpdatedDatetime.slice(0, 10);
  return today;
}

function toTxnInput(t: { id: string; accountId: string; postedDate: ISODate; amount: number; direction: "inflow" | "outflow"; description: string; isTransfer: boolean; transferPairId: string | null }): TransactionInput {
  return {
    id: t.id, accountId: t.accountId, postedDate: t.postedDate, amount: t.amount, direction: t.direction,
    description: t.description, category: null, essential: null, isTransfer: t.isTransfer, transferPairId: t.transferPairId,
  };
}

interface ResolvedAccount {
  /** PFI id when the account exists, else `ext:<external_account_id>` (created this sync). */
  ref: string;
  pfiId: string | null;
  type: AccountType;
  archived: boolean;
}

export function buildSyncPlan(input: SyncPlanInput): SyncPlan {
  const { pages, accountsGet, existingTxns, pfiAccounts, priorAnchors, item, today, now } = input;

  // ---- Roster (§13.1: from /accounts/get) ----
  const mapped: MappedAccount[] = accountsGet.map((a) => mapAccount(a, input.institutionName));
  const itemAccounts = pfiAccounts.filter((a) => a.plaidItemId === item.id);
  const roster = reconcileRoster(mapped, itemAccounts, now);
  const archivedThisSync = new Set(roster.ops.filter((o) => o.op === "archive").map((o) => o.external_account_id));
  const unarchivedThisSync = new Set(roster.ops.filter((o) => o.op === "unarchive").map((o) => o.external_account_id));

  const pfiByExternal = new Map(itemAccounts.filter((a) => a.externalAccountId).map((a) => [a.externalAccountId as string, a]));
  const pfiById = new Map(pfiAccounts.map((a) => [a.id, a]));
  const resolve = new Map<string, ResolvedAccount>();
  for (const m of mapped) {
    const pfi = pfiByExternal.get(m.externalAccountId);
    resolve.set(m.externalAccountId, pfi
      ? { ref: pfi.id, pfiId: pfi.id, type: pfi.type, archived: pfi.archivedAt !== null && !unarchivedThisSync.has(m.externalAccountId) }
      : { ref: `ext:${m.externalAccountId}`, pfiId: null, type: m.type, archived: false });
  }
  // Accounts PFI knows for this Item but Plaid no longer lists: still resolvable for updates/deletes.
  for (const a of itemAccounts) {
    if (a.externalAccountId && !resolve.has(a.externalAccountId)) {
      resolve.set(a.externalAccountId, { ref: a.id, pfiId: a.id, type: a.type, archived: true });
    }
  }
  const externalByPfiId = new Map([...resolve.entries()].filter(([, r]) => r.pfiId).map(([ext, r]) => [r.pfiId as string, ext]));

  // ---- Existing Plaid rows of this Item, by external id ----
  const itemAccountIds = new Set(itemAccounts.map((a) => a.id));
  const existingByExternal = new Map<string, ExistingTxn>();
  for (const t of existingTxns) if (t.externalId && itemAccountIds.has(t.accountId)) existingByExternal.set(t.externalId, t);

  // ---- Inserts ----
  const inserts: PlanInsert[] = [];
  const seenInsert = new Set<string>();
  let pendingSkipped = 0;
  const unknownAccount: string[] = [];
  const consider = [...pages.added, ...pages.modified.filter((m) => !existingByExternal.has(m.transactionId))];
  for (const txn of consider) {
    if (txn.pending) { pendingSkipped++; continue; }
    if (existingByExternal.has(txn.transactionId) || seenInsert.has(txn.transactionId)) continue;
    const acct = resolve.get(txn.accountId);
    if (!acct) { unknownAccount.push(txn.transactionId); continue; }
    seenInsert.add(txn.transactionId);
    inserts.push({ ...toProviderColumns(txn), external_account_id: txn.accountId, external_id: txn.transactionId, pair_key: null });
  }

  // ---- Updates (provider columns only; unpair on substantive change) ----
  const updates: PlanUpdate[] = [];
  const unpairIds = new Set<string>();
  const retractions: RetractionAudit[] = [];
  for (const txn of pages.modified) {
    const existing = existingByExternal.get(txn.transactionId);
    if (!existing || txn.pending) continue;
    const cols: ProviderColumns = toProviderColumns(txn);
    const prior: ProviderColumns = { ...cols, posted_date: existing.postedDate, amount: existing.amount, direction: existing.direction, description: existing.description };
    const substantive = substantiveChange(prior, cols);
    const wasPaired = existing.isTransfer || existing.transferPairId !== null;
    if (substantive) {
      retractions.push({
        external_id: txn.transactionId, action: "modified", reason: "Plaid modified amount, date, or direction",
        prior: { posted_date: existing.postedDate, amount: existing.amount, direction: existing.direction, description: existing.description }, at: now,
      });
      if (wasPaired && existing.transferPairId) unpairIds.add(existing.transferPairId);
    }
    updates.push({ ...cols, id: existing.id, unpair: substantive && wasPaired });
  }

  // ---- Deletes (provider retractions; RPC unpairs survivors) ----
  const deletes: PlanDelete[] = [];
  const deletedIds = new Set<string>();
  for (const r of pages.removed) {
    const existing = existingByExternal.get(r.transactionId);
    if (!existing) continue;
    deletes.push({ id: existing.id });
    deletedIds.add(existing.id);
    retractions.push({
      external_id: r.transactionId, action: "removed", reason: "Plaid removed the transaction",
      prior: { posted_date: existing.postedDate, amount: existing.amount, direction: existing.direction, description: existing.description }, at: now,
    });
  }

  // ---- Pairing (§7): inserts + the user's unpaired, classified existing rows ----
  const candidates: PairCandidate[] = [];
  for (const ins of inserts) {
    const acct = resolve.get(ins.external_account_id)!;
    candidates.push({
      ref: `ext:${ins.external_id}`, accountRef: acct.ref, accountType: acct.type, accountArchived: acct.archived,
      postedDate: ins.posted_date, amount: ins.amount, direction: ins.direction, pfcPrimary: ins.pfc_primary, alreadyPaired: false,
    });
  }
  for (const t of existingTxns) {
    if (t.provider !== "plaid" || t.pfcPrimary === null || deletedIds.has(t.id)) continue;
    const acct = pfiById.get(t.accountId);
    if (!acct) continue;
    const ext = externalByPfiId.get(acct.id);
    const archived = acct.archivedAt !== null && !(ext && unarchivedThisSync.has(ext));
    candidates.push({
      ref: t.id, accountRef: acct.id, accountType: acct.type, accountArchived: archived || (ext ? archivedThisSync.has(ext) : false),
      postedDate: t.postedDate, amount: t.amount, direction: t.direction, pfcPrimary: t.pfcPrimary,
      alreadyPaired: (t.isTransfer || t.transferPairId !== null) && !unpairIds.has(t.id),
    });
  }
  const pairing = pairTransfers(candidates);
  const pairExisting: PlanPairExisting[] = [];
  const insertByRef = new Map(inserts.map((i) => [`ext:${i.external_id}`, i]));
  pairing.pairs.forEach((p, idx) => {
    const key = `pair-${idx + 1}`;
    for (const ref of [p.a, p.b]) {
      const ins = insertByRef.get(ref);
      if (ins) ins.pair_key = key;
      else pairExisting.push({ id: ref, pair_key: key });
    }
  });

  // ---- Anchors (§5): one per shared account with a current balance ----
  const anchors: PlanAnchor[] = [];
  const discrepancies: { external_account_id: string; discrepancy: number }[] = [];
  const anchorsByAccount = new Map<string, BalanceAnchor[]>();
  for (const a of priorAnchors) anchorsByAccount.set(a.accountId, [...(anchorsByAccount.get(a.accountId) ?? []), a]);
  for (const a of accountsGet) {
    if (a.balances.current === null || archivedThisSync.has(a.accountId)) continue;
    const acct = resolve.get(a.accountId)!;
    const anchorDate = anchorDateFor(a.balances.lastUpdatedDatetime, today);
    const balance = Math.round(a.balances.current * 100) / 100;
    let discrepancy: number | null = null;
    if (acct.pfiId) {
      const prior = anchorsByAccount.get(acct.pfiId) ?? [];
      if (prior.some((p) => p.anchorDate === anchorDate && Math.abs(p.balance - balance) < 0.005)) continue; // identical anchor already recorded
      const eff = effectiveAnchor(prior);
      const engineAccount: AccountInput = { id: acct.pfiId, type: acct.type, currentBalance: 0, includeInCalculations: true };
      const txns: TransactionInput[] = [
        ...existingTxns.filter((t) => t.accountId === acct.pfiId && !deletedIds.has(t.id)).map(toTxnInput),
        ...inserts.filter((i) => i.external_account_id === a.accountId).map((i, idx) => toTxnInput({
          id: `pending-${idx}`, accountId: acct.pfiId as string, postedDate: i.posted_date, amount: i.amount, direction: i.direction,
          description: i.description, isTransfer: false, transferPairId: null,
        })),
      ];
      discrepancy = computeDiscrepancy(engineAccount, eff, balance, anchorDate, txns);
      if (discrepancy !== null && discrepancy !== 0) discrepancies.push({ external_account_id: a.accountId, discrepancy });
    }
    anchors.push({
      external_account_id: a.accountId, anchor_date: anchorDate, balance, observed_at: now,
      source_updated_at: a.balances.lastUpdatedDatetime, freshness: "cached", discrepancy,
    });
  }

  // ---- Item ----
  const status = deriveItemStatus(pages.updateStatus, item.status, item.historyCompleteAt);

  return {
    item: {
      cursor: pages.nextCursor, update_status: pages.updateStatus, status,
      history_complete: pages.updateStatus === "HISTORICAL_UPDATE_COMPLETE", error_code: null,
    },
    accounts: roster.ops,
    deletes,
    unpair_ids: [...unpairIds],
    updates,
    pair_existing: pairExisting,
    inserts,
    anchors,
    reconciliation_results: {
      retractions, roster: roster.audit, ambiguous_transfers: pairing.ambiguous, discrepancies,
    },
    sync_metadata: {
      request_ids: pages.requestIds, update_status: pages.updateStatus,
      cursor_before: item.cursor, cursor_after: pages.nextCursor, pending_skipped: pendingSkipped,
      ...(unknownAccount.length > 0 ? { unknown_account_transactions: unknownAccount.length } : {}),
    },
  };
}
