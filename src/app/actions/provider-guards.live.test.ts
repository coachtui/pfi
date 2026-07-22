/**
 * Live-Supabase integration test for the manual-only provider guards that
 * live inside the server actions themselves (not RLS):
 *   - createTransaction rejects inserting into a non-manual account.
 *   - deleteTransaction rejects deleting a transaction on a non-manual account.
 *   - updateAccount rejects editing a non-manual account.
 *   - deleteAccount only deletes manual accounts, preserves cross-account
 *     transfer integrity, and cleans up account-owned import history.
 * See docs/DECISIONS.md #13 — imported (demo/csv) data must never be
 * individually deletable, and manual transactions only ever land on manual
 * accounts. Whole-account deletion is a separate, deliberate operation.
 * `scripts/test-rls.mts` covers cross-tenant RLS isolation and the DB
 * trigger, but these guards are plain application logic in
 * src/app/actions/{transactions,accounts}.ts, so RLS tests can't reach them.
 *
 * `createClient()` in src/lib/supabase/server.ts calls next/headers'
 * cookies(), which only works inside a real Next.js request. To call the
 * actions directly from Vitest, we swap that module for one that returns a
 * REAL, live Supabase client (@supabase/supabase-js, same library
 * scripts/test-rls.mts uses) already signed in as a real throwaway user —
 * this is a genuine RLS-bound session and every DB round-trip below is real,
 * not mocked. Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * and SUPABASE_SERVICE_ROLE_KEY (see .env.local, loaded by vitest.config.ts).
 *
 * This suite creates and tears down one real auth user (and their accounts /
 * transactions / snapshots, which cascade-delete with the user) in the
 * linked Supabase project on every run.
 */
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above these imports; vi.hoisted lets the
// factory close over a value we only populate later, in beforeAll, once the
// real signed-in client exists.
const state = vi.hoisted(() => ({ client: undefined as SupabaseClient | undefined }));

// `finish-mutation.ts` (used by createTransaction/updateAccount on success)
// transitively imports the `server-only` marker package, which throws
// unconditionally outside Next's "react-server" resolution condition.
vi.mock("server-only", () => ({}));
// revalidatePath() requires a live Next.js request/build context; outside of
// one it throws, so stub it — cache invalidation isn't what this suite tests.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!state.client)
      throw new Error("test Supabase client not initialized — beforeAll must run first");
    return state.client;
  },
}));

import { createTransaction, deleteTransaction } from "./transactions";
import { deleteAccount, updateAccount } from "./accounts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("manual-only provider guards (live Supabase)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let userId: string;
  let manualAccountId: string;
  let demoAccountId: string;
  let demoTransactionId: string;
  let deletableAccountId: string;
  let deletableImportBatchId: string;

  beforeAll(async () => {
    if (!url || !anonKey || !serviceKey) {
      throw new Error(
        "provider-guards.test.ts needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and " +
          "SUPABASE_SERVICE_ROLE_KEY — this suite calls the real server actions against a live Supabase " +
          "project and cannot run against a mock. Populate .env.local (see scripts/test-rls.mts for the " +
          "same requirement); vitest.config.ts loads it automatically.",
      );
    }

    admin = createSupabaseClient(url, serviceKey);

    const email = `provider-guard-test-${randomUUID().slice(0, 8)}@example.com`;
    const password = `Test-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;

    userClient = createSupabaseClient(url, anonKey);
    const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);
    state.client = userClient;

    // Satisfies the FK the accounts/transactions inserts below depend on.
    const { error: profileErr } = await userClient.from("user_profiles").insert({
      id: userId,
      username: `provider_guard_${randomUUID().slice(0, 6)}`,
      age_cohort: "30–39",
      income_band: "$50k–$100k",
      household_type: "Single",
      col_cohort: "Mid-Cost Region",
      objective: "reduce_debt",
    });
    if (profileErr) throw new Error(`profile insert failed: ${profileErr.message}`);

    const { data: manualAcct, error: manualErr } = await userClient
      .from("financial_accounts")
      .insert({
        user_id: userId,
        provider: "manual",
        type: "checking",
        display_name: "Guard test checking",
      })
      .select("id")
      .single();
    if (manualErr || !manualAcct)
      throw new Error(`manual account insert failed: ${manualErr?.message}`);
    manualAccountId = manualAcct.id;

    // createAccount always forces provider: 'manual' (see accounts.ts), so a
    // demo-provider account has to be seeded directly — bypassing the app
    // layer — to have something for the guards to reject against. RLS only
    // checks ownership (auth.uid() = user_id), not provider, so the user's
    // own client can insert this directly.
    const { data: demoAcct, error: demoErr } = await userClient
      .from("financial_accounts")
      .insert({
        user_id: userId,
        provider: "demo",
        type: "checking",
        display_name: "Guard test demo",
      })
      .select("id")
      .single();
    if (demoErr || !demoAcct) throw new Error(`demo account insert failed: ${demoErr?.message}`);
    demoAccountId = demoAcct.id;

    // Likewise, createTransaction itself would reject writing to a demo
    // account, so seed directly to have a row for deleteTransaction to reject.
    const { data: demoTxn, error: demoTxnErr } = await userClient
      .from("transactions")
      .insert({
        account_id: demoAccountId,
        user_id: userId,
        posted_date: "2026-01-01",
        amount: 25,
        direction: "outflow",
        description: "Seed demo transaction",
      })
      .select("id")
      .single();
    if (demoTxnErr || !demoTxn)
      throw new Error(`demo transaction insert failed: ${demoTxnErr?.message}`);
    demoTransactionId = demoTxn.id;

    const { data: deletableAcct, error: deletableErr } = await userClient
      .from("financial_accounts")
      .insert({
        user_id: userId,
        provider: "manual",
        type: "checking",
        display_name: "Delete test checking",
      })
      .select("id")
      .single();
    if (deletableErr || !deletableAcct) {
      throw new Error(`deletable account insert failed: ${deletableErr?.message}`);
    }
    deletableAccountId = deletableAcct.id;
    deletableImportBatchId = randomUUID();

    const { error: batchErr } = await userClient.from("import_batches").insert({
      id: deletableImportBatchId,
      user_id: userId,
      source_type: "csv",
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    });
    if (batchErr) throw new Error(`delete test import batch insert failed: ${batchErr.message}`);

    const { error: deleteTxnErr } = await userClient.from("transactions").insert({
      account_id: deletableAccountId,
      user_id: userId,
      posted_date: "2026-01-03",
      amount: 75,
      direction: "inflow",
      description: "Imported delete test transaction",
      import_batch_id: deletableImportBatchId,
    });
    if (deleteTxnErr)
      throw new Error(`delete test transaction insert failed: ${deleteTxnErr.message}`);

    const { error: deleteAnchorErr } = await userClient.from("balance_anchors").insert({
      account_id: deletableAccountId,
      user_id: userId,
      anchor_date: "2026-01-03",
      balance: 75,
      source: "import",
      import_batch_id: deletableImportBatchId,
    });
    if (deleteAnchorErr)
      throw new Error(`delete test anchor insert failed: ${deleteAnchorErr.message}`);
  });

  afterAll(async () => {
    if (userId && admin) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (err) {
        // Cascades wipe the user's profile/accounts/transactions/snapshots;
        // surface (but don't fail the run on) cleanup problems.
        console.error(`cleanup: failed to delete test user: ${(err as Error).message}`);
      }
    }
  });

  it("createTransaction succeeds on the user's own manual account", async () => {
    const result = await createTransaction({
      accountId: manualAccountId,
      postedDate: "2026-01-02",
      amount: 42,
      direction: "outflow",
      description: "Manual account transaction",
    });
    expect(result.error).toBe("");

    const { data, error } = await userClient
      .from("transactions")
      .select("id")
      .eq("account_id", manualAccountId)
      .eq("description", "Manual account transaction");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("createTransaction rejects inserting into the user's own demo-provider account", async () => {
    const result = await createTransaction({
      accountId: demoAccountId,
      postedDate: "2026-01-02",
      amount: 42,
      direction: "outflow",
      description: "Should never land",
    });
    expect(result.error).toBe("Transactions can only be added to manual accounts");

    const { data } = await userClient
      .from("transactions")
      .select("id")
      .eq("account_id", demoAccountId)
      .eq("description", "Should never land");
    expect(data).toHaveLength(0);
  });

  it("deleteTransaction rejects deleting a transaction on a demo-provider account", async () => {
    const result = await deleteTransaction(demoTransactionId);
    expect(result.error).toBe("Imported transactions can't be deleted — recategorize them instead");

    const { data } = await userClient.from("transactions").select("id").eq("id", demoTransactionId);
    expect(data).toHaveLength(1); // still there
  });

  it("updateAccount rejects editing the user's own demo-provider account", async () => {
    const result = await updateAccount({
      id: demoAccountId,
      displayName: "Hacked demo name",
      type: "checking",
      currentBalance: 999,
    });
    expect(result.error).toBe("Demo accounts can't be edited — reload demo data to reset them");

    const { data } = await userClient
      .from("financial_accounts")
      .select("display_name")
      .eq("id", demoAccountId)
      .single();
    expect(data?.display_name).toBe("Guard test demo");
  });

  it("deleteAccount rejects deleting a demo-provider account", async () => {
    const result = await deleteAccount(demoAccountId);
    expect(result.error).toBe("Only your manually created accounts can be deleted here");

    const { data } = await userClient
      .from("financial_accounts")
      .select("id")
      .eq("id", demoAccountId);
    expect(data).toHaveLength(1);
  });

  it("deleteAccount blocks deletion when another account points to one of its transfers", async () => {
    const { data: linkedAcct, error: linkedAcctErr } = await userClient
      .from("financial_accounts")
      .insert({
        user_id: userId,
        provider: "manual",
        type: "savings",
        display_name: "Linked delete test savings",
      })
      .select("id")
      .single();
    if (linkedAcctErr || !linkedAcct) throw new Error(linkedAcctErr?.message);

    const { data: targetTxn, error: targetTxnErr } = await userClient
      .from("transactions")
      .insert({
        account_id: manualAccountId,
        user_id: userId,
        posted_date: "2026-01-04",
        amount: 50,
        direction: "outflow",
        description: "Transfer to savings",
        is_transfer: true,
      })
      .select("id")
      .single();
    if (targetTxnErr || !targetTxn) throw new Error(targetTxnErr?.message);

    const { error: linkedTxnErr } = await userClient.from("transactions").insert({
      account_id: linkedAcct.id,
      user_id: userId,
      posted_date: "2026-01-04",
      amount: 50,
      direction: "inflow",
      description: "Transfer from checking",
      is_transfer: true,
      transfer_pair_id: targetTxn.id,
    });
    if (linkedTxnErr) throw new Error(linkedTxnErr.message);

    const result = await deleteAccount(manualAccountId);
    expect(result.error).toBe(
      "This account is linked to 1 transfer on other accounts. Archive it instead so those records stay accurate.",
    );

    const { data } = await userClient
      .from("financial_accounts")
      .select("id")
      .eq("id", manualAccountId);
    expect(data).toHaveLength(1);
  });

  it("deleteAccount removes a manual account, its data, and its sole import batch", async () => {
    const result = await deleteAccount(deletableAccountId);
    expect(result.error).toBe("");

    const [{ data: account }, { data: transactions }, { data: anchors }, { data: batch }] =
      await Promise.all([
        userClient.from("financial_accounts").select("id").eq("id", deletableAccountId),
        userClient.from("transactions").select("id").eq("account_id", deletableAccountId),
        userClient.from("balance_anchors").select("id").eq("account_id", deletableAccountId),
        userClient.from("import_batches").select("id").eq("id", deletableImportBatchId),
      ]);
    expect(account).toHaveLength(0);
    expect(transactions).toHaveLength(0);
    expect(anchors).toHaveLength(0);
    expect(batch).toHaveLength(0);
  });
});
