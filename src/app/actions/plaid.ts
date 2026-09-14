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
import { mapAccount } from "@/lib/plaid/map-account";
import { loadAccessToken, loadOwnedItem, syncAllItems, syncPlaidItem, type SyncOutcome } from "@/lib/plaid/sync";
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
  const { user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const client = getPlaidClient();
  if (!client) return { error: "Bank connections are not configured." };
  try {
    const { linkToken } = await plaidCreateLinkToken(client.api, user.id, { clientName: branding.productName });
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
    const accessToken = await loadAccessToken(item.id);
    const { linkToken } = await plaidCreateLinkToken(client.api, user.id, { clientName: branding.productName, accessToken });
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

  // Duplicate-institution guard.
  let institutionId = parsed.data.institutionId;
  try {
    const roster = await fetchAccounts(client.api, accessToken);
    institutionId = institutionId ?? roster.institutionId;
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
          await removeItem(client.api, accessToken).catch(() => undefined);
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
    await removeItem(client.api, accessToken).catch(() => undefined);
    return { error: `Could not save the connection: ${itemErr?.message ?? "insert failed"}` };
  }
  const itemId = itemRow.id as string;

  try {
    const enc = await encryptToken(accessToken, client.cfg.tokenKey, keyVersionOf(client.cfg.tokenKey));
    const admin = createAdminClient();
    const { error: secretErr } = await admin.from("plaid_item_secrets")
      .insert({ plaid_item_id: itemId, access_token_ciphertext: enc.ciphertext, key_version: enc.keyVersion });
    if (secretErr) throw new Error(secretErr.message);
  } catch (e) {
    console.error(`[plaid] secret store failed for item ${itemId}: ${e instanceof Error ? e.message : "unknown"}`);
    await removeItem(client.api, accessToken).catch(() => undefined);
    await supabase.from("plaid_items").delete().eq("id", itemId);
    return { error: "Could not secure the connection's credentials. Nothing was saved — try again." };
  }

  const outcome = await syncPlaidItem(supabase, user.id, itemId, { force: true });
  return toExchangeResult(itemId, outcome);
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

export async function syncItem(itemId: unknown, force = false): Promise<SyncResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const parsed = itemIdSchema.safeParse(itemId);
  if (!parsed.success) return { error: "Invalid connection id" };
  const outcome = await syncPlaidItem(supabase, user.id, parsed.data, { force });
  if (!outcome.ok) return { error: outcome.error, throttled: outcome.throttled };
  return {
    error: "", warning: outcome.rebuildWarning, status: outcome.status, historyComplete: outcome.historyComplete, counts: outcome.counts,
    rosterChanges: outcome.plan.reconciliation_results.roster.length,
    ambiguousTransfers: outcome.plan.reconciliation_results.ambiguous_transfers.length,
  };
}

export async function syncAll(force = false): Promise<MutationResult> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Not authenticated" };
  const outcomes = await syncAllItems(supabase, user.id, { force });
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

  const removed = await removeAtPlaid(item.id);
  if (!removed.ok) {
    await supabase.from("plaid_items").update({ status: "disconnect_pending", error_code: removed.code ?? null }).eq("id", item.id);
    return { error: "Plaid did not confirm the disconnect. The connection stays listed so you can retry — it may still be billable until it succeeds." };
  }

  await supabase.from("plaid_items").update({ status: "disconnected", error_code: null }).eq("id", item.id);
  await createAdminClient().from("plaid_item_secrets").delete().eq("plaid_item_id", item.id);
  await supabase.from("financial_accounts")
    .update({ archived_at: new Date().toISOString(), roster_status: "unshared", connection_status: "disconnected" })
    .eq("plaid_item_id", item.id).is("archived_at", null);
  return finishWithRebuild(supabase);
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
    const removed = await removeAtPlaid(item.id);
    if (!removed.ok) {
      await supabase.from("plaid_items").update({ status: "disconnect_pending", error_code: removed.code ?? null }).eq("id", item.id);
      return { error: "Plaid did not confirm the disconnect, so nothing was deleted. Retry in a moment." };
    }
    await createAdminClient().from("plaid_item_secrets").delete().eq("plaid_item_id", item.id);
  }
  const { error: rpcErr } = await supabase.rpc("delete_connected_item_data", { p_item_id: item.id });
  if (rpcErr) return { error: `Disconnected, but deleting the data failed: ${rpcErr.message}` };
  return finishWithRebuild(supabase);
}

async function removeAtPlaid(itemId: string): Promise<{ ok: true } | { ok: false; code?: string }> {
  const client = getPlaidClient();
  if (!client) return { ok: false, code: "NOT_CONFIGURED" };
  let accessToken: string;
  try {
    accessToken = await loadAccessToken(itemId);
  } catch {
    // No secret stored: nothing at Plaid can be addressed from here; treat as already removed.
    return { ok: true };
  }
  try {
    await removeItem(client.api, accessToken);
    return { ok: true };
  } catch (e) {
    if (e instanceof PlaidCallError && (e.errorCode === "ITEM_NOT_FOUND" || e.errorCode === "INVALID_ACCESS_TOKEN")) return { ok: true };
    return { ok: false, code: e instanceof PlaidCallError ? e.errorCode : undefined };
  }
}
