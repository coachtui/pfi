/**
 * Plain, SDK-free shapes for the Plaid integration (DECISIONS #43). Every
 * module in src/lib/plaid except client.ts and sync.ts works on these types
 * only, so mappers and the sync-plan reducer are unit-testable without the
 * `plaid` package or a network. `client.ts` narrows SDK responses into these.
 */
import type { AccountType } from "@/lib/financial-engine";
import type { Category } from "@/lib/config/categories";

export type ISODate = string;

/** Plaid `/accounts/get` account, narrowed. */
export interface PlaidAccountShape {
  accountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  /** Plaid `type`: depository | credit | loan | investment | other (+ future). */
  type: string;
  /** Plaid `subtype`, lower-case, e.g. "checking", "credit card", "401k". */
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    limit: number | null;
    /** ISO timestamp; Plaid returns it for a handful of institutions only. */
    lastUpdatedDatetime: string | null;
  };
}

export type PfcVersion = "v1" | "v2";
export type CategoryConfidence = "very_high" | "high" | "medium" | "low" | "unknown";

/** Plaid `/transactions/sync` transaction, narrowed. */
export interface PlaidTransactionShape {
  transactionId: string;
  accountId: string;
  /** Plaid sign convention: positive = money out of the account. */
  amount: number;
  date: ISODate;
  authorizedDate: ISODate | null;
  name: string;
  merchantName: string | null;
  pending: boolean;
  personalFinanceCategory: {
    primary: string;
    detailed: string;
    confidenceLevel: string | null;
  } | null;
  taxonomyVersion: PfcVersion;
}

export type UpdateStatus =
  | "TRANSACTIONS_UPDATE_STATUS_UNKNOWN"
  | "NOT_READY"
  | "INITIAL_UPDATE_COMPLETE"
  | "HISTORICAL_UPDATE_COMPLETE";

export type ItemStatus =
  | "initializing"
  | "history_loading"
  | "connected"
  | "login_required"
  | "error"
  | "disconnect_pending"
  | "disconnected";

/** Everything received from paging `/transactions/sync` to completion. */
export interface SyncPages {
  added: PlaidTransactionShape[];
  modified: PlaidTransactionShape[];
  removed: { transactionId: string; accountId: string | null }[];
  nextCursor: string;
  updateStatus: UpdateStatus;
  requestIds: string[];
}

/** Provider-owned transaction columns (spec §6). The only columns sync ever writes on an existing row. */
export interface ProviderColumns {
  posted_date: ISODate;
  authorized_date: ISODate | null;
  amount: number;
  direction: "inflow" | "outflow";
  description: string;
  category: Category;
  category_confidence: CategoryConfidence;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  category_taxonomy_version: PfcVersion;
}

/** A PFI transaction row as the plan reducer needs to see it. */
export interface ExistingTxn {
  id: string;
  accountId: string;
  externalId: string | null;
  postedDate: ISODate;
  amount: number;
  direction: "inflow" | "outflow";
  description: string;
  isTransfer: boolean;
  transferPairId: string | null;
  provider: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
}

/** A PFI account row as roster/pairing need to see it. */
export interface PfiAccount {
  id: string;
  type: AccountType;
  provider: string;
  plaidItemId: string | null;
  externalAccountId: string | null;
  archivedAt: string | null;
  rosterStatus: "shared" | "unshared" | "closed" | null;
}

// ---- SyncPlan: the exact jsonb `commit_connected_sync` consumes (migration 0015 §10) ----

export interface PlanAccountOp {
  op: "create" | "archive" | "unarchive" | "keep";
  external_account_id: string;
  type?: AccountType;
  display_name?: string;
  institution?: string | null;
  mask?: string | null;
  credit_limit?: number | null;
  roster_status?: "shared" | "unshared" | "closed";
}

export interface PlanInsert extends ProviderColumns {
  external_account_id: string;
  external_id: string;
  pair_key: string | null;
}

export interface PlanUpdate extends ProviderColumns {
  id: string;
  unpair: boolean;
}

/** An existing (unpaired) row joining a transfer pair with a new insert. */
export interface PlanPairExisting {
  id: string;
  pair_key: string;
}

export interface PlanDelete {
  id: string;
}

export interface PlanAnchor {
  external_account_id: string;
  anchor_date: ISODate;
  balance: number;
  observed_at: string;
  source_updated_at: string | null;
  freshness: "cached";
  discrepancy: number | null;
}

export interface RetractionAudit {
  external_id: string;
  action: "removed" | "modified";
  reason: string;
  prior: { posted_date: ISODate; amount: number; direction: "inflow" | "outflow"; description: string };
  at: string;
}

export interface RosterAudit {
  external_account_id: string;
  change: "created" | "unshared" | "closed" | "reappeared";
  at: string;
}

export interface SyncPlan {
  item: {
    /** Null when Plaid returned no cursor yet (NOT_READY): the RPC keeps the stored one. */
    cursor: string | null;
    update_status: UpdateStatus;
    status: ItemStatus;
    history_complete: boolean;
    error_code: string | null;
  };
  accounts: PlanAccountOp[];
  deletes: PlanDelete[];
  unpair_ids: string[];
  updates: PlanUpdate[];
  pair_existing: PlanPairExisting[];
  inserts: PlanInsert[];
  anchors: PlanAnchor[];
  reconciliation_results: {
    retractions: RetractionAudit[];
    roster: RosterAudit[];
    ambiguous_transfers: string[];
    discrepancies: { external_account_id: string; discrepancy: number }[];
  };
  sync_metadata: {
    request_ids: string[];
    update_status: UpdateStatus;
    cursor_before: string | null;
    cursor_after: string | null;
    pending_skipped: number;
  };
}

/** Counts returned by `commit_connected_sync`. */
export interface CommitResult {
  inserted: number;
  updated: number;
  deleted: number;
  anchored: number;
  accounts_created: number;
  accounts_archived: number;
  pairs: number;
}
