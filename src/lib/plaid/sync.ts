import "server-only";
/**
 * Sync orchestration (spec §5). Runs inside a signed-in server action:
 * ownership read → throttle → decrypt token (admin client, secrets only) →
 * batch row → /accounts/get + /transactions/sync pages → pure plan →
 * ONE transactional commit (RPC) → finishWithRebuild → rebuild flag.
 *
 * Nothing is written to transactions/anchors/accounts/items outside the RPC.
 * The cursor advances only when the RPC commits.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BalanceAnchor } from "@/lib/financial-engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import { rebuildSnapshots } from "@/lib/data/rebuild-snapshots";
import { paginateSelect } from "@/lib/data/paginate";
import { LOGIN_REQUIRED_CODES, PlaidCallError, fetchAccounts, fetchSyncPages, getPlaidClient } from "./client";
import { decryptToken, keyRingFor } from "./crypto";
import { buildSyncPlan } from "./sync-plan";
import type { CommitResult, ExistingTxn, ItemStatus, PfiAccount, SyncPlan } from "./types";

const PAGE_SIZE = 1000;
/** Automatic (dashboard-load) syncs: 10 minutes between attempts, 1 minute while history is loading. */
export const SYNC_THROTTLE_MS = 10 * 60 * 1000;
export const SYNC_THROTTLE_LOADING_MS = 60 * 1000;
/** User-initiated syncs ("Sync now", connect, reconnect): a short server-side floor, never a bypass. */
export const SYNC_THROTTLE_USER_MS = 20 * 1000;

export type SyncTrigger = "user" | "auto";

export interface ItemRow {
  id: string; user_id: string; item_id: string; institution_id: string | null; institution_name: string | null;
  status: ItemStatus; history_complete_at: string | null; transactions_cursor: string | null;
  last_synced_at: string | null; last_sync_attempt_at: string | null; error_code: string | null;
}

export type SyncOutcome =
  | { ok: true; batchId: string; counts: CommitResult; status: ItemStatus; historyComplete: boolean; rebuildWarning?: string; plan: Pick<SyncPlan, "reconciliation_results"> }
  | { ok: false; error: string; code?: string; throttled?: boolean };

/** Owner-scoped Item read. RLS hides other users' Items; the explicit user_id filter makes that intent visible. */
export async function loadOwnedItem(supabase: SupabaseClient, userId: string, itemId: string): Promise<ItemRow | null> {
  const { data, error } = await supabase.from("plaid_items")
    .select("id, user_id, item_id, institution_id, institution_name, status, history_complete_at, transactions_cursor, last_synced_at, last_sync_attempt_at, error_code")
    .eq("id", itemId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ItemRow | null) ?? null;
}

/**
 * Decrypt the Item's access token. The admin client is used for this one read
 * only, and the query itself is pinned to the owning user (join on
 * plaid_items.user_id) so a future caller cannot hand another user's token
 * out. Returns null when NO secret row exists (the Item was already
 * disconnected); throws on every failure (not configured, DB error, decrypt
 * failure) so callers never mistake a broken key for a removed Item.
 */
export async function loadAccessToken(userId: string, itemId: string): Promise<string | null> {
  const client = getPlaidClient();
  if (!client) throw new Error("Plaid is not configured");
  const admin = createAdminClient();
  const { data, error } = await admin.from("plaid_item_secrets")
    .select("access_token_ciphertext, key_version, plaid_items!inner(user_id)")
    .eq("plaid_item_id", itemId).eq("plaid_items.user_id", userId).maybeSingle();
  if (error) throw new Error(`secret read failed: ${error.message}`);
  if (!data) return null;
  return decryptToken(
    { ciphertext: data.access_token_ciphertext as string, keyVersion: Number(data.key_version) },
    keyRingFor(client.cfg.tokenKey, client.cfg.previousTokenKey),
  );
}

export function throttleWindowMs(item: Pick<ItemRow, "status">, trigger: SyncTrigger): number {
  if (trigger === "user") return SYNC_THROTTLE_USER_MS;
  return item.status === "initializing" || item.status === "history_loading" ? SYNC_THROTTLE_LOADING_MS : SYNC_THROTTLE_MS;
}

/**
 * Atomically claim the sync attempt: ONE conditional update on
 * `last_sync_attempt_at`. Two concurrent loads cannot both pass (the loser's
 * update matches zero rows), so an Item is never synced twice in parallel.
 */
async function claimSyncAttempt(supabase: SupabaseClient, item: ItemRow, trigger: SyncTrigger, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - throttleWindowMs(item, trigger)).toISOString();
  const { data, error } = await supabase.from("plaid_items")
    .update({ last_sync_attempt_at: now.toISOString() })
    .eq("id", item.id)
    .or(`last_sync_attempt_at.is.null,last_sync_attempt_at.lt.${cutoff}`)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) === 1;
}

interface TxnRow {
  id: string; account_id: string; external_id: string | null; posted_date: string; amount: number; direction: string;
  description: string; is_transfer: boolean; transfer_pair_id: string | null; pfc_primary: string | null; pfc_detailed: string | null;
}
interface AcctRow {
  id: string; type: string; provider: string; plaid_item_id: string | null; external_account_id: string | null; archived_at: string | null; roster_status: string | null;
}
interface AnchorRow { account_id: string; anchor_date: string; balance: number; created_at: string }

async function loadUserRows(supabase: SupabaseClient): Promise<{ existingTxns: ExistingTxn[]; pfiAccounts: PfiAccount[]; priorAnchors: BalanceAnchor[] }> {
  const [acctRes, txnRows, anchorRows] = await Promise.all([
    supabase.from("financial_accounts").select("id, type, provider, plaid_item_id, external_account_id, archived_at, roster_status"),
    paginateSelect<TxnRow>(PAGE_SIZE, (from, to) =>
      supabase.from("transactions")
        .select("id, account_id, external_id, posted_date, amount, direction, description, is_transfer, transfer_pair_id, pfc_primary, pfc_detailed")
        .order("id", { ascending: true }).range(from, to)),
    paginateSelect<AnchorRow>(PAGE_SIZE, (from, to) =>
      supabase.from("balance_anchors").select("account_id, anchor_date, balance, created_at").order("id", { ascending: true }).range(from, to)),
  ]);
  if (acctRes.error) throw new Error(acctRes.error.message);
  const pfiAccounts: PfiAccount[] = (acctRes.data as AcctRow[]).map((a) => ({
    id: a.id, type: a.type as PfiAccount["type"], provider: a.provider, plaidItemId: a.plaid_item_id,
    externalAccountId: a.external_account_id, archivedAt: a.archived_at, rosterStatus: a.roster_status as PfiAccount["rosterStatus"],
  }));
  const providerById = new Map(pfiAccounts.map((a) => [a.id, a.provider]));
  const existingTxns: ExistingTxn[] = txnRows.map((t) => ({
    id: t.id, accountId: t.account_id, externalId: t.external_id, postedDate: t.posted_date, amount: Number(t.amount),
    direction: t.direction as "inflow" | "outflow", description: t.description, isTransfer: t.is_transfer,
    transferPairId: t.transfer_pair_id, provider: providerById.get(t.account_id) ?? "unknown", pfcPrimary: t.pfc_primary, pfcDetailed: t.pfc_detailed,
  }));
  const priorAnchors: BalanceAnchor[] = anchorRows.map((r) => ({
    accountId: r.account_id, anchorDate: r.anchor_date, balance: Number(r.balance), createdAt: r.created_at,
  }));
  return { existingTxns, pfiAccounts, priorAnchors };
}

/** Error types that describe the Item/institution itself; anything else (API_ERROR, RATE_LIMIT, INVALID_REQUEST…) is transient or ours and must not flip the Item. */
const ITEM_LEVEL_ERROR_TYPES: ReadonlySet<string> = new Set(["ITEM_ERROR", "INSTITUTION_ERROR"]);

async function markItemStatus(supabase: SupabaseClient, item: ItemRow, status: ItemStatus, errorCode: string | null): Promise<void> {
  await supabase.from("plaid_items").update({ status, error_code: errorCode }).eq("id", item.id);
  await supabase.from("financial_accounts")
    .update({ connection_status: status === "login_required" || status === "error" ? status : "ok" })
    .eq("plaid_item_id", item.id);
}

/** Mark a batch failed — only while it is still in flight. A batch the RPC already confirmed is never re-marked (a lost HTTP response must not hide a committed sync from the rebuild repair). */
async function failBatch(supabase: SupabaseClient, batchId: string, reason: string, requestIds: string[]): Promise<void> {
  await supabase.from("import_batches")
    .update({ status: "failed", failure_reason: reason, sync_metadata: { request_ids: requestIds } })
    .eq("id", batchId).eq("status", "extracting");
}

/**
 * Sync one Item for the signed-in user. Returns `{ ok: false }` on every
 * failure path with a user-safe message; throws only on programmer error.
 */
export async function syncPlaidItem(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  opts: { trigger?: SyncTrigger; now?: Date; revalidate?: boolean } = {},
): Promise<SyncOutcome> {
  const client = getPlaidClient();
  if (!client) return { ok: false, error: "Bank connections are not configured." };
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);

  const item = await loadOwnedItem(supabase, userId, itemId);
  if (!item) return { ok: false, error: "Connection not found." };
  if (item.status === "disconnected" || item.status === "disconnect_pending") return { ok: false, error: "This connection is disconnected." };
  if (!(await claimSyncAttempt(supabase, item, opts.trigger ?? "auto", now))) {
    return { ok: false, error: "Synced a moment ago — try again shortly.", throttled: true };
  }

  let accessToken: string | null;
  try {
    accessToken = await loadAccessToken(userId, item.id);
  } catch (e) {
    console.error(`[plaid] token load failed for item ${item.id}: ${e instanceof Error ? e.message : "unknown"}`);
    return { ok: false, error: "This connection's credentials are unavailable. Reconnect or disconnect it." };
  }
  if (accessToken === null) return { ok: false, error: "This connection has no stored credentials. Disconnect it and connect again." };

  const { data: batch, error: batchErr } = await supabase.from("import_batches")
    .insert({ user_id: userId, source_type: "connected_account", status: "extracting", plaid_item_id: item.id, detected_institution: item.institution_name })
    .select("id").single();
  if (batchErr || !batch) {
    console.error(`[plaid] batch insert failed for item ${item.id}: ${batchErr?.message ?? "no row"}`);
    return { ok: false, error: "Could not start the sync — try again." };
  }
  const batchId = batch.id as string;
  const requestIds: string[] = [];
  let committed: { commit: CommitResult; plan: SyncPlan } | null = null;

  try {
    const [rosterRes, pages] = await Promise.all([
      fetchAccounts(client.api, accessToken),
      fetchSyncPages(client.api, accessToken, item.transactions_cursor),
    ]);
    requestIds.push(rosterRes.requestId, ...pages.requestIds);

    const rows = await loadUserRows(supabase);
    const plan = buildSyncPlan({
      pages, accountsGet: rosterRes.accounts, institutionName: item.institution_name, ...rows,
      item: { id: item.id, status: item.status, historyCompleteAt: item.history_complete_at, cursor: item.transactions_cursor },
      today, now: nowIso,
    });

    const { data: commit, error: rpcErr } = await supabase.rpc("commit_connected_sync", { p_batch_id: batchId, p_plan: plan });
    if (rpcErr) {
      await failBatch(supabase, batchId, `commit failed: ${rpcErr.message}`, requestIds);
      console.error(`[plaid] commit_connected_sync failed for batch ${batchId}: ${rpcErr.message}`);
      return { ok: false, error: "The sync could not be saved. Nothing was changed — try again." };
    }
    committed = { commit: commit as CommitResult, plan };
  } catch (e) {
    if (e instanceof PlaidCallError) {
      if (e.requestId) requestIds.push(e.requestId);
      await failBatch(supabase, batchId, `${e.errorType}/${e.errorCode}`, requestIds);
      if (e.errorType === "RATE_LIMIT_EXCEEDED") return { ok: false, error: "Plaid is rate-limiting requests — try again in a few minutes.", code: e.errorCode };
      if (LOGIN_REQUIRED_CODES.has(e.errorCode)) {
        await markItemStatus(supabase, item, "login_required", e.errorCode);
        return { ok: false, error: "This connection needs to be reconnected.", code: e.errorCode };
      }
      if (e.errorCode === "PRODUCT_NOT_READY") {
        // Freshly linked: Plaid has not finished the initial pull. Not an error state.
        await markItemStatus(supabase, item, item.history_complete_at ? "connected" : "history_loading", null);
        return { ok: false, error: "Plaid is still preparing this connection's history. Check again shortly.", code: e.errorCode };
      }
      if (ITEM_LEVEL_ERROR_TYPES.has(e.errorType)) {
        await markItemStatus(supabase, item, "error", e.errorCode);
        return { ok: false, error: "Plaid reported a problem with this connection.", code: e.errorCode };
      }
      // Transient / API-level: the batch is failed, the Item keeps its status.
      return { ok: false, error: "Plaid could not sync this connection right now — try again shortly.", code: e.errorCode };
    }
    const message = e instanceof Error ? e.message : "sync failed";
    await failBatch(supabase, batchId, message, requestIds);
    console.error(`[plaid] sync failed for batch ${batchId}: ${message}`);
    return { ok: false, error: "The sync failed before anything was saved — try again." };
  }

  // Post-commit work lives outside the try: the cursor has advanced, so a
  // failure here must never mark the batch failed or claim "nothing changed".
  const { commit, plan } = committed;
  // Server actions revalidate; the dashboard-load path (a render) may only
  // rebuild — revalidatePath is not allowed during rendering.
  let warning: string | undefined;
  try {
    const finish = opts.revalidate === false
      ? await rebuildSnapshots(supabase).then((r) => (r.error ? { error: "", warning: `Saved — but the index recalculation failed: ${r.error}` } : { error: "" }))
      : await finishWithRebuild(supabase);
    warning = finish.warning;
    if (!finish.warning) {
      await supabase.from("import_batches").update({ rebuild_completed_at: new Date().toISOString() }).eq("id", batchId);
    }
  } catch (e) {
    warning = `Saved — but the index recalculation failed: ${e instanceof Error ? e.message : "unknown"}. It will retry on your next dashboard load.`;
  }
  return {
    ok: true, batchId, counts: commit, status: plan.item.status, historyComplete: plan.item.history_complete,
    rebuildWarning: warning, plan: { reconciliation_results: plan.reconciliation_results },
  };
}

/** Sync every active Item of the user (dashboard-load path). Best-effort; never throws. */
export async function syncAllItems(supabase: SupabaseClient, userId: string, opts: { trigger?: SyncTrigger; revalidate?: boolean } = {}): Promise<SyncOutcome[]> {
  const { data, error } = await supabase.from("plaid_items").select("id").eq("user_id", userId)
    .in("status", ["initializing", "history_loading", "connected", "login_required", "error"]);
  if (error || !data) return [];
  const out: SyncOutcome[] = [];
  for (const row of data as { id: string }[]) out.push(await syncPlaidItem(supabase, userId, row.id, opts));
  return out;
}
