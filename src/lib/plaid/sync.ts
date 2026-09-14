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
export const SYNC_THROTTLE_MS = 10 * 60 * 1000;
export const SYNC_THROTTLE_LOADING_MS = 60 * 1000;

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

/** Decrypt the Item's access token. The admin client is used for this one read only. */
export async function loadAccessToken(itemId: string): Promise<string> {
  const client = getPlaidClient();
  if (!client) throw new Error("Plaid is not configured");
  const admin = createAdminClient();
  const { data, error } = await admin.from("plaid_item_secrets")
    .select("access_token_ciphertext, key_version").eq("plaid_item_id", itemId).maybeSingle();
  if (error) throw new Error(`secret read failed: ${error.message}`);
  if (!data) throw new Error("no access token stored for this connection");
  return decryptToken(
    { ciphertext: data.access_token_ciphertext as string, keyVersion: Number(data.key_version) },
    keyRingFor(client.cfg.tokenKey, client.cfg.previousTokenKey),
  );
}

export function throttled(item: ItemRow, nowMs: number): boolean {
  if (!item.last_sync_attempt_at) return false;
  const since = nowMs - Date.parse(item.last_sync_attempt_at);
  const window = item.status === "initializing" || item.status === "history_loading" ? SYNC_THROTTLE_LOADING_MS : SYNC_THROTTLE_MS;
  return since < window;
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

async function markItemError(supabase: SupabaseClient, item: ItemRow, err: PlaidCallError): Promise<void> {
  const status: ItemStatus = LOGIN_REQUIRED_CODES.has(err.errorCode) ? "login_required" : "error";
  await supabase.from("plaid_items").update({ status, error_code: err.errorCode }).eq("id", item.id);
  await supabase.from("financial_accounts").update({ connection_status: status }).eq("plaid_item_id", item.id);
}

async function failBatch(supabase: SupabaseClient, batchId: string, reason: string, requestIds: string[]): Promise<void> {
  await supabase.from("import_batches")
    .update({ status: "failed", failure_reason: reason, sync_metadata: { request_ids: requestIds } })
    .eq("id", batchId);
}

/**
 * Sync one Item for the signed-in user. Returns `{ ok: false }` on every
 * failure path with a user-safe message; throws only on programmer error.
 */
export async function syncPlaidItem(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  opts: { force?: boolean; now?: Date; revalidate?: boolean } = {},
): Promise<SyncOutcome> {
  const client = getPlaidClient();
  if (!client) return { ok: false, error: "Bank connections are not configured." };
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);

  const item = await loadOwnedItem(supabase, userId, itemId);
  if (!item) return { ok: false, error: "Connection not found." };
  if (item.status === "disconnected" || item.status === "disconnect_pending") return { ok: false, error: "This connection is disconnected." };
  if (!opts.force && throttled(item, now.getTime())) return { ok: false, error: "Synced recently — try again in a few minutes.", throttled: true };

  await supabase.from("plaid_items").update({ last_sync_attempt_at: nowIso }).eq("id", item.id);

  let accessToken: string;
  try {
    accessToken = await loadAccessToken(item.id);
  } catch (e) {
    console.error(`[plaid] token load failed for item ${item.id}: ${e instanceof Error ? e.message : "unknown"}`);
    return { ok: false, error: "This connection's credentials are unavailable. Reconnect or disconnect it." };
  }

  const { data: batch, error: batchErr } = await supabase.from("import_batches")
    .insert({ user_id: userId, source_type: "connected_account", status: "extracting", plaid_item_id: item.id, detected_institution: item.institution_name })
    .select("id").single();
  if (batchErr || !batch) return { ok: false, error: `Could not start the sync: ${batchErr?.message ?? "batch insert failed"}` };
  const batchId = batch.id as string;
  const requestIds: string[] = [];

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

    // Server actions revalidate; the dashboard-load path (a render) may only
    // rebuild — revalidatePath is not allowed during rendering.
    const finish = opts.revalidate === false
      ? await rebuildSnapshots(supabase).then((r) => (r.error ? { error: "", warning: `Saved — but the index recalculation failed: ${r.error}` } : { error: "" }))
      : await finishWithRebuild(supabase);
    if (!finish.warning) {
      await supabase.from("import_batches").update({ rebuild_completed_at: new Date().toISOString() }).eq("id", batchId);
    }
    return {
      ok: true, batchId, counts: commit as CommitResult, status: plan.item.status, historyComplete: plan.item.history_complete,
      rebuildWarning: finish.warning, plan: { reconciliation_results: plan.reconciliation_results },
    };
  } catch (e) {
    if (e instanceof PlaidCallError) {
      if (e.requestId) requestIds.push(e.requestId);
      await failBatch(supabase, batchId, `${e.errorType}/${e.errorCode}`, requestIds);
      if (e.errorType === "RATE_LIMIT_EXCEEDED") return { ok: false, error: "Plaid is rate-limiting requests — try again in a few minutes.", code: e.errorCode };
      await markItemError(supabase, item, e);
      return LOGIN_REQUIRED_CODES.has(e.errorCode)
        ? { ok: false, error: "This connection needs to be reconnected.", code: e.errorCode }
        : { ok: false, error: "Plaid could not sync this connection right now.", code: e.errorCode };
    }
    const message = e instanceof Error ? e.message : "sync failed";
    await failBatch(supabase, batchId, message, requestIds);
    console.error(`[plaid] sync failed for batch ${batchId}: ${message}`);
    return { ok: false, error: "The sync failed before anything was saved — try again." };
  }
}

/** Sync every active Item of the user (dashboard-load path). Best-effort; never throws. */
export async function syncAllItems(supabase: SupabaseClient, userId: string, opts: { force?: boolean; revalidate?: boolean } = {}): Promise<SyncOutcome[]> {
  const { data, error } = await supabase.from("plaid_items").select("id").eq("user_id", userId)
    .in("status", ["initializing", "history_loading", "connected", "login_required", "error"]);
  if (error || !data) return [];
  const out: SyncOutcome[] = [];
  for (const row of data as { id: string }[]) out.push(await syncPlaidItem(supabase, userId, row.id, opts));
  return out;
}
