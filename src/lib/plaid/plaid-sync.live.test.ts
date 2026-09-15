/**
 * Live sandbox integration test for Plaid Slice 1 (spec §12, acceptance
 * criteria §13.1–§13.4). Runs the REAL server actions against the linked
 * Supabase project and Plaid's Sandbox environment, bypassing Link's iframe
 * with /sandbox/public_token/create.
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, PLAID_CLIENT_ID, PLAID_SECRET (sandbox), and
 * PLAID_TOKEN_ENCRYPTION_KEY. Skips with a clear message when Plaid vars are
 * absent. Run with `pnpm test:live`. Creates and tears down one auth user and
 * one sandbox Item.
 */
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: undefined as SupabaseClient | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!state.client) throw new Error("test Supabase client not initialized");
    return state.client;
  },
}));

import { Products } from "plaid";
import { disconnectItem, exchangePublicToken, syncItem } from "@/app/actions/plaid";
import { getPlaidClient } from "./client";
import { loadAccessToken } from "./sync";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const plaidReady = Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.PLAID_TOKEN_ENCRYPTION_KEY);

const SANDBOX_INSTITUTION = "ins_109508"; // First Platypus Bank

describe.skipIf(!plaidReady)("Plaid Slice 1 — sandbox link + sync (live)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let userId: string;
  let itemId: string;

  beforeAll(async () => {
    if (!url || !anonKey || !serviceKey) throw new Error("plaid-sync.live.test.ts needs the Supabase env vars in .env.local");
    admin = createSupabaseClient(url, serviceKey);
    const email = `plaid-live-${randomUUID().slice(0, 8)}@example.com`;
    const password = `Test-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    userClient = createSupabaseClient(url, anonKey);
    const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);
    state.client = userClient;
    const { error: profileErr } = await userClient.from("user_profiles").insert({
      id: userId, username: `plaid_live_${randomUUID().slice(0, 6)}`, age_cohort: "30–39", income_band: "$50k–$100k",
      household_type: "Single", col_cohort: "Mid-Cost Region", objective: "reduce_debt", onboarding_completed_at: new Date().toISOString(),
    });
    if (profileErr) throw new Error(`profile insert failed: ${profileErr.message}`);
  }, 60_000);

  afterAll(async () => {
    try {
      if (itemId) await disconnectItem(itemId).catch(() => undefined);
    } finally {
      if (admin && userId) await admin.auth.admin.deleteUser(userId).catch((e: Error) => console.error(`cleanup: ${e.message}`));
    }
  }, 60_000);

  it("links a sandbox Item, reaches connected, creates the full roster, inserts posted rows, anchors cached balances, rebuilds", async () => {
    const client = getPlaidClient();
    expect(client).not.toBeNull();
    const { data: pt } = await client!.api.sandboxPublicTokenCreate({
      institution_id: SANDBOX_INSTITUTION,
      initial_products: [Products.Transactions],
      options: { transactions: { days_requested: 90 } },
    });

    const linked = await exchangePublicToken({ publicToken: pt.public_token, institutionId: SANDBOX_INSTITUTION, institutionName: "First Platypus Bank" });
    expect(linked.error).toBe("");
    expect(linked.itemId).toBeTruthy();
    itemId = linked.itemId!;

    // §13.4: partial history is a real state; poll until HISTORICAL_UPDATE_COMPLETE.
    let status = linked.status ?? "initializing";
    for (let i = 0; i < 16 && status !== "connected"; i++) {
      await new Promise((r) => setTimeout(r, 25_000)); // user-initiated floor is 20s
      const r = await syncItem(itemId);
      if (r.throttled) continue;
      expect(r.error).toBe("");
      status = r.status ?? status;
    }
    expect(status).toBe("connected");

    const { data: item } = await userClient.from("plaid_items").select("status, history_complete_at, transactions_cursor").eq("id", itemId).single();
    expect(item?.history_complete_at).toBeTruthy();
    expect(item?.transactions_cursor).toBeTruthy();

    // §13.1: roster from /accounts/get — the sandbox Item has investment accounts with no transactions; they must still exist and be anchored.
    const { data: accounts } = await userClient.from("financial_accounts").select("id, type, external_account_id, roster_status").eq("plaid_item_id", itemId);
    expect((accounts ?? []).length).toBeGreaterThanOrEqual(2);
    expect((accounts ?? []).some((a) => a.type === "brokerage" || a.type === "retirement")).toBe(true);
    const accountIds = (accounts ?? []).map((a) => a.id);
    const { data: anchors } = await userClient.from("balance_anchors").select("account_id, freshness, source").in("account_id", accountIds);
    expect(new Set((anchors ?? []).map((a) => a.account_id)).size).toBe(accountIds.length);
    expect((anchors ?? []).every((a) => a.source === "sync" && a.freshness === "cached")).toBe(true);

    // §13.2: taxonomy provenance on every synced row.
    const { data: txns } = await userClient.from("transactions").select("id, external_id, pfc_primary, category_taxonomy_version, category").in("account_id", accountIds);
    expect((txns ?? []).length).toBeGreaterThan(0);
    expect((txns ?? []).every((t) => t.external_id && t.category_taxonomy_version && t.category)).toBe(true);

    const { data: snaps } = await userClient.from("daily_snapshots").select("date").limit(1);
    expect((snaps ?? []).length).toBe(1);
  }, 480_000);

  it("re-sync is idempotent and preserves a user override; a stale token surfaces login_required", async () => {
    const { data: row } = await userClient.from("transactions").select("id").not("external_id", "is", null).limit(1).single();
    const { error: ovErr } = await userClient.from("transactions").update({ user_override: { category: "groceries" } }).eq("id", row!.id);
    expect(ovErr).toBeNull();

    await new Promise((r) => setTimeout(r, 21_000));
    const again = await syncItem(itemId);
    expect(again.error).toBe("");
    expect(again.counts?.inserted).toBe(0);
    const { data: after } = await userClient.from("transactions").select("user_override").eq("id", row!.id).single();
    expect((after?.user_override as { category?: string })?.category).toBe("groceries");

    // Reset the sandbox login: next sync must flag login_required, never wipe data.
    const client = getPlaidClient()!;
    const accessToken = await loadAccessToken(userId, itemId);
    await client.api.sandboxItemResetLogin({ access_token: accessToken as string });
    await new Promise((r) => setTimeout(r, 21_000));
    const broken = await syncItem(itemId);
    expect(broken.error).toMatch(/reconnect/i);
    const { data: item } = await userClient.from("plaid_items").select("status").eq("id", itemId).single();
    expect(item?.status).toBe("login_required");
    const { data: txns } = await userClient.from("transactions").select("id").not("external_id", "is", null).limit(1);
    expect((txns ?? []).length).toBe(1);
  }, 120_000);

  it("cross-user RPC call and foreign ids are rejected; cursor unchanged", async () => {
    const { data: before } = await userClient.from("plaid_items").select("transactions_cursor").eq("id", itemId).single();
    const { data: batch } = await userClient.from("import_batches")
      .insert({ user_id: userId, source_type: "connected_account", status: "extracting", plaid_item_id: itemId }).select("id").single();
    const { error } = await userClient.rpc("commit_connected_sync", {
      p_batch_id: batch!.id,
      p_plan: { updates: [{ id: randomUUID(), posted_date: "2026-01-01", amount: 1, direction: "outflow", description: "x" }] },
    });
    expect(error?.message).toMatch(/ownership \(updates\)/);
    const { data: after } = await userClient.from("plaid_items").select("transactions_cursor").eq("id", itemId).single();
    expect(after?.transactions_cursor).toBe(before?.transactions_cursor);
    await userClient.from("import_batches").delete().eq("id", batch!.id);
  }, 60_000);

  it("disconnect removes the Item at Plaid first, then the secret, and archives accounts with history kept", async () => {
    const res = await disconnectItem(itemId);
    expect(res.error).toBe("");
    const { data: item } = await userClient.from("plaid_items").select("status").eq("id", itemId).single();
    expect(item?.status).toBe("disconnected");
    const { data: secret } = await admin.from("plaid_item_secrets").select("plaid_item_id").eq("plaid_item_id", itemId).maybeSingle();
    expect(secret).toBeNull();
    const { data: accounts } = await userClient.from("financial_accounts").select("archived_at, roster_status").eq("plaid_item_id", itemId);
    expect((accounts ?? []).every((a) => a.archived_at !== null && a.roster_status === "unshared")).toBe(true);
    const { data: txns } = await userClient.from("transactions").select("id").not("external_id", "is", null).limit(1);
    expect((txns ?? []).length).toBe(1); // history kept
    // /item/remove already happened: a second removal is a no-op at Plaid (ITEM_NOT_FOUND is tolerated).
    const again = await disconnectItem(itemId);
    expect(again.error).toBe("");
  }, 60_000);
});
