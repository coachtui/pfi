"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import { branding } from "@/lib/config/branding";
import {
  PlaidCallError, createLinkToken as plaidCreateLinkToken, exchangePublicToken as plaidExchange,
  fetchAccounts, getPlaidClient, removeItem,
} from "@/lib/plaid/client";
import { encryptToken, keyVersionOf } from "@/lib/plaid/crypto";
import { capMessage, countActiveItems } from "@/lib/plaid/items";
import { mapAccount } from "@/lib/plaid/map-account";
import { loadAccessToken, loadOwnedItem, syncAllItems, syncPlaidItem, type SyncOutcome } from "@/lib/plaid/sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaidServerConfig } from "@/lib/config/env.server";
import { exchangePublicTokenSchema, itemIdSchema } from "@/lib/validation/plaid";
import type { MutationResult } from "@/lib/validation/transactions";

/**
 * Plaid server actions (spec §4, §9, §11). Every action: auth → Zod →
 * RLS-scoped ownership read → work → user-safe result. Tokens never leave
 * the server; the admin client touches only `plaid_item_secrets`.
 */

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export interface LinkTokenResult { error: string; linkToken?: string }

export async function createLinkToken(): Promise<LinkTokenResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const client = getPlaidClient();
  if (!client) return { error: "Bank connections are not configured." };
  try {
    // Item cap (spec §1c): enforced here, not only in the UI — each Item is billable.
    if ((await countActiveItems(supabase, user.id)) >= client.cfg.maxItems) return { error: capMessage(client.cfg.maxItems) };
    const { linkToken } = await plaidCreateLinkToken(client.api, user.id, { clientName: branding.productName, redirectUri: client.cfg.redirectUri });
    return { error: "", linkToken };
  } catch (e) {
    return { error: e instanceof PlaidCallError ? "Could not start the bank connection. Try again shortly." : "Could not start the bank connection." };
  }
}

/** Link update mode for an Item that needs re-authentication. */
export async function createUpdateLinkToken(itemId: unknown): Promise<LinkTokenResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const parsed = itemIdSchema.safeParse(itemId);
  if (!parsed.success) return { error: "Invalid connection id" };
  const client = getPlaidClient();
  if (!client) return { error: "Bank connections are not configured." };
  const item = await loadOwnedItem(supabase, user.id, parsed.data);
  if (!item) return { error: "Connection not found." };
  try {
    const accessToken = await loadAccessToken(user.id, item.id);
    if (!accessToken) return { error: "This connection has no stored credentials. Disconnect it and connect again." };
    const { linkToken } = await plaidCreateLinkToken(client.api, user.id, { clientName: branding.productName, accessToken, redirectUri: client.cfg.redirectUri });
    return { error: "", linkToken };
  } catch {
    return { error: "Could not start reconnection. Try again shortly." };
  }
}

export interface ExchangeResult extends MutationResult {
  itemId?: string;
  status?: string;
  historyComplete?: boolean;
  counts?: { inserted: number; anchored: number; accounts_created: number };
}

/**
 * Exchange a Link `public_token`, store the encrypted access token, and run
 * the first sync (which creates the roster through the transactional RPC).
 * A second Item at an already-connected institution is refused and removed
 * immediately so no billable duplicate lingers (spec §4 step 3).
 */
export async function exchangePublicToken(input: unknown): Promise<ExchangeResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const parsed = exchangePublicTokenSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const client = getPlaidClient();
  if (!client) return { error: "Bank connections are not configured." };

  let accessToken: string;
  let plaidItemId: string;
  try {
    ({ accessToken, itemId: plaidItemId } = await plaidExchange(client.api, parsed.data.publicToken));
  } catch {
    return { error: "The bank connection could not be completed. Try again." };
  }

  // Cap re-check at exchange time: two tabs can each hold a link token minted under the cap.
  try {
    if ((await countActiveItems(supabase, user.id)) >= client.cfg.maxItems) {
      await quarantineNewItem(supabase, user.id, client.cfg, accessToken, { plaidItemId, institutionId: parsed.data.institutionId, institutionName: parsed.data.institutionName, reason: "ITEM_CAP" });
      return { error: capMessage(client.cfg.maxItems) };
    }
  } catch {
    // Count failed: fall through to the insert, which is still RLS-scoped; the cap is a billing bound, not a security boundary.
  }

  // Duplicate-institution guard. Plaid's own institution id wins over Link metadata.
  let institutionId = parsed.data.institutionId;
  try {
    const roster = await fetchAccounts(client.api, accessToken);
    institutionId = roster.institutionId ?? institutionId;
    if (institutionId) {
      const { data: siblings } = await supabase.from("plaid_items").select("id")
        .eq("user_id", user.id).eq("institution_id", institutionId).neq("status", "disconnected");
      const siblingIds = (siblings ?? []).map((s: { id: string }) => s.id);
      if (siblingIds.length > 0) {
        const { data: siblingAccounts } = await supabase.from("financial_accounts").select("type, mask")
          .in("plaid_item_id", siblingIds);
        const known = new Set((siblingAccounts ?? []).map((a: { type: string; mask: string | null }) => `${a.type}|${a.mask ?? ""}`));
        const dup = roster.accounts.map((a) => mapAccount(a, null)).some((m) => known.has(`${m.type}|${m.mask ?? ""}`));
        if (dup) {
          await quarantineNewItem(supabase, user.id, client.cfg, accessToken, { plaidItemId, institutionId, institutionName: parsed.data.institutionName, reason: "DUPLICATE_INSTITUTION" });
          return { error: "This institution is already connected. Use Reconnect on the existing connection instead." };
        }
      }
    }
  } catch {
    // Roster lookup failed: proceed without the guard rather than leak a billable Item — the first sync will surface errors.
  }

  const { data: itemRow, error: itemErr } = await supabase.from("plaid_items")
    .insert({ user_id: user.id, item_id: plaidItemId, institution_id: institutionId, institution_name: parsed.data.institutionName, status: "initializing" })
    .select("id").single();
  if (itemErr || !itemRow) {
    console.error(`[plaid] plaid_items insert failed: ${itemErr?.message ?? "no row"}`);
    // Only a collision on Plaid's item_id means this Item is already recorded (a retried exchange).
    // Any other failure — including the one-active-Item-per-institution index — leaves a live,
    // billable Item that must be removed or recorded as retryable, never dropped.
    const knownItem = itemErr?.code === "23505" && /plaid_items_item_id_key/.test(itemErr.message ?? "");
    if (!knownItem) {
      await quarantineNewItem(supabase, user.id, client.cfg, accessToken, { plaidItemId, institutionId, institutionName: parsed.data.institutionName, reason: "ITEM_INSERT_FAILED" });
    }
    return { error: "Could not save the connection — try again." };
  }
  const itemId = itemRow.id as string;

  const stored = await storeSecret(client.cfg, itemId, accessToken);
  if (!stored) {
    // Removed at Plaid if possible; otherwise kept as disconnect_pending so it can be retried — never silently orphaned.
    const removed = await removeItem(client.api, accessToken).then(() => true).catch(() => false);
    if (removed) await supabase.from("plaid_items").update({ status: "disconnected", error_code: "SECRET_STORE_FAILED" }).eq("id", itemId);
    else await supabase.from("plaid_items").update({ status: "disconnect_pending", error_code: "SECRET_STORE_FAILED" }).eq("id", itemId);
    return { error: "Could not secure the connection's credentials — nothing was synced. Try again." };
  }

  const outcome = await syncPlaidItem(supabase, user.id, itemId, { trigger: "user" });
  return toExchangeResult(itemId, outcome);
}

/** Encrypt + store an access token (admin client; secrets table only). False on failure (logged, never the token). */
async function storeSecret(cfg: PlaidServerConfig, itemId: string, accessToken: string): Promise<boolean> {
  try {
    const enc = await encryptToken(accessToken, cfg.tokenKey, keyVersionOf(cfg.tokenKey));
    const { error } = await createAdminClient().from("plaid_item_secrets")
      .insert({ plaid_item_id: itemId, access_token_ciphertext: enc.ciphertext, key_version: enc.keyVersion });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error(`[plaid] secret store failed for item ${itemId}: ${e instanceof Error ? e.message : "unknown"}`);
    return false;
  }
}

/**
 * Roll back a just-exchanged Item we will not keep: `/item/remove` first. If
 * Plaid refuses, the Item is still live and billable, so it is recorded as
 * `disconnect_pending` WITH its encrypted token so "Retry disconnect" can
 * reach it later — never discarded (spec §4 step 4, SECURITY_MODEL user control).
 */
async function quarantineNewItem(
  supabase: SupabaseClient, userId: string, cfg: PlaidServerConfig, accessToken: string,
  meta: { plaidItemId: string; institutionId: string | null; institutionName: string | null; reason: string },
): Promise<void> {
  const client = getPlaidClient();
  const removed = client ? await removeItem(client.api, accessToken).then(() => true).catch(() => false) : false;
  if (removed) return;
  console.error(`[plaid] /item/remove failed during exchange rollback (${meta.reason}); keeping Item retryable`);
  const record = (institutionId: string | null) => supabase.from("plaid_items")
    .upsert(
      { user_id: userId, item_id: meta.plaidItemId, institution_id: institutionId, institution_name: meta.institutionName, status: "disconnect_pending", error_code: meta.reason },
      { onConflict: "item_id" },
    )
    .select("id").single();
  let { data: row, error } = await record(meta.institutionId);
  // The per-institution active-Item index can refuse the row; record it without the institution rather than lose a billable Item.
  if ((error || !row) && meta.institutionId) ({ data: row, error } = await record(null));
  if (error || !row) {
    console.error(`[plaid] could not record quarantined Item: ${error?.message ?? "no row"}`);
    return;
  }
  await storeSecret(cfg, row.id as string, accessToken);
}

function toExchangeResult(itemId: string, outcome: SyncOutcome): ExchangeResult {
  if (!outcome.ok) {
    // The Item exists and is retryable/disconnectable from the card; surface the sync problem as a warning.
    return { error: "", warning: `Connected, but the first sync did not complete: ${outcome.error}`, itemId };
  }
  return {
    error: "", warning: outcome.rebuildWarning, itemId, status: outcome.status, historyComplete: outcome.historyComplete,
    counts: { inserted: outcome.counts.inserted, anchored: outcome.counts.anchored, accounts_created: outcome.counts.accounts_created },
  };
}

export interface SyncResult extends MutationResult {
  status?: string;
  historyComplete?: boolean;
  counts?: { inserted: number; updated: number; deleted: number; anchored: number; accounts_created: number; accounts_archived: number; pairs: number };
  rosterChanges?: number;
  ambiguousTransfers?: number;
  throttled?: boolean;
}

export async function syncItem(itemId: unknown): Promise<SyncResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const parsed = itemIdSchema.safeParse(itemId);
  if (!parsed.success) return { error: "Invalid connection id" };
  const outcome = await syncPlaidItem(supabase, user.id, parsed.data, { trigger: "user" });
  if (!outcome.ok) return { error: outcome.error, throttled: outcome.throttled };
  return {
    error: "", warning: outcome.rebuildWarning, status: outcome.status, historyComplete: outcome.historyComplete, counts: outcome.counts,
    rosterChanges: outcome.plan.reconciliation_results.roster.length,
    ambiguousTransfers: outcome.plan.reconciliation_results.ambiguous_transfers.length,
  };
}

export async function syncAll(): Promise<MutationResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const outcomes = await syncAllItems(supabase, user.id, { trigger: "user" });
  const failed = outcomes.filter((o) => !o.ok && !o.throttled);
  if (failed.length > 0) return { error: "", warning: `${failed.length} connection${failed.length === 1 ? "" : "s"} did not sync.` };
  return { error: "" };
}

/**
 * Disconnect: `/item/remove` FIRST (ends billing), then mark disconnected,
 * delete the secret, archive the accounts (history kept). If Plaid refuses,
 * the Item becomes `disconnect_pending` — still visible, still retryable.
 */
export async function disconnectItem(itemId: unknown): Promise<MutationResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const parsed = itemIdSchema.safeParse(itemId);
  if (!parsed.success) return { error: "Invalid connection id" };
  const item = await loadOwnedItem(supabase, user.id, parsed.data);
  if (!item) return { error: "Connection not found." };
  if (item.status === "disconnected") return { error: "" };

  const removed = await removeAtPlaid(user.id, item.id);
  if (!removed.ok) {
    await supabase.from("plaid_items").update({ status: "disconnect_pending", error_code: removed.code ?? null }).eq("id", item.id);
    return { error: "Plaid did not confirm the disconnect. The connection stays listed so you can retry — it may still be billable until it succeeds." };
  }

  await supabase.from("plaid_items").update({ status: "disconnected", error_code: null }).eq("id", item.id);
  await createAdminClient().from("plaid_item_secrets").delete().eq("plaid_item_id", item.id);
  await supabase.from("financial_accounts")
    .update({ archived_at: new Date().toISOString(), roster_status: "unshared", connection_status: "disconnected" })
    .eq("plaid_item_id", item.id).is("archived_at", null);
  return finishOrFlagRebuild(supabase, user.id);
}

/** Like finishWithRebuild, but a failed rebuild is remembered on the profile so the dashboard repairs it under the lease. */
async function finishOrFlagRebuild(supabase: SupabaseClient, userId: string): Promise<MutationResult> {
  const finish = await finishWithRebuild(supabase);
  if (finish.warning) await supabase.from("user_profiles").update({ rebuild_pending_at: new Date().toISOString() }).eq("id", userId);
  return finish;
}

/** Disconnect AND delete every account, transaction, anchor, and batch of the Item (spec §9 deletion policy). */
export async function deleteItemData(itemId: unknown): Promise<MutationResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const parsed = itemIdSchema.safeParse(itemId);
  if (!parsed.success) return { error: "Invalid connection id" };
  const item = await loadOwnedItem(supabase, user.id, parsed.data);
  if (!item) return { error: "Connection not found." };

  if (item.status !== "disconnected") {
    const removed = await removeAtPlaid(user.id, item.id);
    if (!removed.ok) {
      await supabase.from("plaid_items").update({ status: "disconnect_pending", error_code: removed.code ?? null }).eq("id", item.id);
      return { error: "Plaid did not confirm the disconnect, so nothing was deleted. Retry in a moment." };
    }
    // Removed at Plaid: record that before touching data, so an RPC failure
    // below leaves a truthful "disconnected" state (retry deletes the data).
    await supabase.from("plaid_items").update({ status: "disconnected", error_code: null }).eq("id", item.id);
    await createAdminClient().from("plaid_item_secrets").delete().eq("plaid_item_id", item.id);
  }
  const { error: rpcErr } = await supabase.rpc("delete_connected_item_data", { p_item_id: item.id });
  if (rpcErr) {
    console.error(`[plaid] delete_connected_item_data failed for item ${item.id}: ${rpcErr.message}`);
    return { error: "Disconnected, but deleting the data failed — retry \"Delete its data\"." };
  }
  return finishOrFlagRebuild(supabase, user.id);
}

async function removeAtPlaid(userId: string, itemId: string): Promise<{ ok: true } | { ok: false; code?: string }> {
  const client = getPlaidClient();
  if (!client) return { ok: false, code: "NOT_CONFIGURED" };
  let accessToken: string | null;
  try {
    accessToken = await loadAccessToken(userId, itemId);
  } catch (e) {
    // A broken key, DB error, or missing config is NOT "already removed": the
    // Item may still be live and billable. Leave it retryable (disconnect_pending).
    console.error(`[plaid] token unavailable for disconnect of item ${itemId}: ${e instanceof Error ? e.message : "unknown"}`);
    return { ok: false, code: "TOKEN_UNAVAILABLE" };
  }
  // No secret row at all: the Item was already disconnected here; nothing at Plaid can be addressed.
  if (accessToken === null) return { ok: true };
  try {
    await removeItem(client.api, accessToken);
    return { ok: true };
  } catch (e) {
    if (e instanceof PlaidCallError && (e.errorCode === "ITEM_NOT_FOUND" || e.errorCode === "INVALID_ACCESS_TOKEN")) return { ok: true };
    return { ok: false, code: e instanceof PlaidCallError ? e.errorCode : undefined };
  }
}
