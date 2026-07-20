/**
 * Tenant-isolation test: creates two throwaway users, seeds a profile and an
 * account for user A, then asserts user B cannot read, write, update, or
 * delete any of A's rows through the anon-key client. Exits 1 on any failure.
 * Cleans up both users (cascades wipe their rows).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey);
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}

async function makeUser(tag: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `rls-test-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Test-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const client = createClient(url, anonKey);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);
  return { id: data.user.id, client };
}

let a: { id: string; client: SupabaseClient } | undefined;
let b: { id: string; client: SupabaseClient } | undefined;

try {
  a = await makeUser("a");
  b = await makeUser("b");

  // A creates their rows.
  const { error: pErr } = await a.client.from("user_profiles").insert({
    id: a.id, username: `rls_a_${randomUUID().slice(0, 6)}`, age_cohort: "30–39",
    income_band: "$50k–$100k", household_type: "Single", col_cohort: "Mid-Cost Region",
    objective: "reduce_debt",
  });
  check("A can insert own profile", !pErr, pErr?.message);

  const { data: acct, error: aErr } = await a.client.from("financial_accounts")
    .insert({ user_id: a.id, provider: "manual", type: "checking", display_name: "A checking" })
    .select("id").single();
  check("A can insert own account", !aErr && !!acct, aErr?.message);

  // B (needs own profile to satisfy FKs on their own writes).
  await b.client.from("user_profiles").insert({
    id: b.id, username: `rls_b_${randomUUID().slice(0, 6)}`, age_cohort: "30–39",
    income_band: "$50k–$100k", household_type: "Single", col_cohort: "Mid-Cost Region",
    objective: "reduce_debt",
  });

  // B attempts to touch A's data.
  const { data: readProfiles, error: readProfilesErr } = await b.client
    .from("user_profiles").select("*").eq("id", a.id);
  check(
    "B cannot read A's profile",
    !readProfilesErr && (readProfiles ?? []).length === 0,
    readProfilesErr?.message ?? "",
  );

  const { data: readAccounts, error: readAccountsErr } = await b.client
    .from("financial_accounts").select("*").eq("user_id", a.id);
  check(
    "B cannot read A's accounts",
    !readAccountsErr && (readAccounts ?? []).length === 0,
    readAccountsErr?.message ?? "",
  );

  const { error: forgeErr } = await b.client.from("financial_accounts")
    .insert({ user_id: a.id, provider: "manual", type: "checking", display_name: "forged" });
  check("B cannot insert rows owned by A", !!forgeErr);

  const { data: updated, error: updatedErr } = await b.client.from("financial_accounts")
    .update({ display_name: "hacked" }).eq("id", acct!.id).select();
  check(
    "B cannot update A's account",
    !updatedErr && (updated ?? []).length === 0,
    updatedErr?.message ?? "",
  );

  const { data: deleted, error: deletedErr } = await b.client.from("financial_accounts")
    .delete().eq("id", acct!.id).select();
  check(
    "B cannot delete A's account",
    !deletedErr && (deleted ?? []).length === 0,
    deletedErr?.message ?? "",
  );

  const { data: snapForge, error: snapErr } = await b.client.from("daily_snapshots")
    .insert({
      user_id: a.id, date: "2026-01-01", liquid_assets: 0, revolving_balances: 0,
      near_term_obligations: 0, essential_obligations: 0, safety_buffer: 0, net_worth: 0,
      engine_version: "test",
    }).select();
  check("B cannot insert snapshots for A", !!snapErr || (snapForge ?? []).length === 0);

  const anonClient = createClient(url, anonKey);
  const { data: anonRead, error: anonReadErr } = await anonClient.from("user_profiles").select("*");
  check(
    "Unauthenticated client reads nothing",
    !anonReadErr && (anonRead ?? []).length === 0,
    anonReadErr?.message ?? "",
  );

  // ---- Manual-data slice: transaction mutation isolation ----
  const { data: aTxn, error: aTxnErr } = await a.client
    .from("transactions")
    .insert({
      account_id: acct!.id, user_id: a.id, posted_date: "2026-07-01",
      amount: 50, direction: "outflow", description: "RLS manual txn",
    })
    .select("id")
    .single();
  check("A can insert a transaction into own manual account", !aTxnErr && !!aTxn, aTxnErr?.message);

  const { error: aImmErr } = await a.client
    .from("transactions").update({ amount: 60 }).eq("id", aTxn!.id);
  check("A cannot edit frozen source columns (immutability trigger)", !!aImmErr);

  const { error: aOvErr } = await a.client
    .from("transactions").update({ user_override: { category: "other" } }).eq("id", aTxn!.id);
  check("A can write own user_override", !aOvErr, aOvErr?.message);

  const { data: bOv } = await b.client
    .from("transactions").update({ user_override: { category: "income" } }).eq("id", aTxn!.id).select("id");
  check("B cannot override A's transaction", (bOv ?? []).length === 0);

  const { data: bDel } = await b.client
    .from("transactions").delete().eq("id", aTxn!.id).select("id");
  check("B cannot delete A's transaction", (bDel ?? []).length === 0);

  const { data: bArch } = await b.client
    .from("financial_accounts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", acct!.id)
    .select("id");
  check("B cannot archive A's account", (bArch ?? []).length === 0);

  // ---- CSV import slice: import_batch_id isolation + immutability ----
  const importBatchId = randomUUID();
  const { error: impErr } = await a.client.from("transactions").insert({
    account_id: acct!.id, user_id: a.id, posted_date: "2026-07-01", amount: 12.34,
    direction: "outflow", description: "rls import row", category: "other",
    import_batch_id: importBatchId,
  });
  check("A can insert an imported row with a batch id", !impErr, impErr?.message);

  const { data: bBatchRead, error: bBatchReadErr } = await b.client.from("transactions")
    .select("id").eq("import_batch_id", importBatchId);
  check(
    "B cannot read A's imported batch rows",
    !bBatchReadErr && (bBatchRead ?? []).length === 0,
    bBatchReadErr?.message ?? "",
  );

  const { data: bBatchDel } = await b.client.from("transactions")
    .delete().eq("import_batch_id", importBatchId).select("id");
  check("B cannot delete A's imported batch rows (undo isolation)", (bBatchDel ?? []).length === 0);

  const { error: aBatchMutErr } = await a.client.from("transactions")
    .update({ import_batch_id: randomUUID() }).eq("import_batch_id", importBatchId).select("id").single();
  check("import_batch_id is immutable after insert", !!aBatchMutErr);

  // ---- Recurring detection slice: recurring_overrides isolation ----
  const { error: ovInsertOwn } = await a.client.from("recurring_overrides")
    .insert({ user_id: a.id, series_key: "deadbeef", status: "dismissed" });
  check("recurring_overrides: owner can insert", !ovInsertOwn, ovInsertOwn?.message ?? "");

  const { data: ovCrossRead } = await b.client.from("recurring_overrides").select("series_key");
  check("recurring_overrides: cross-user read returns nothing", (ovCrossRead ?? []).length === 0);

  const { error: ovForge } = await b.client.from("recurring_overrides")
    .insert({ user_id: a.id, series_key: "cafef00d", status: "confirmed" });
  check("recurring_overrides: cross-user insert rejected", !!ovForge);

  await b.client.from("recurring_overrides")
    .update({ status: "confirmed" }).eq("user_id", a.id).eq("series_key", "deadbeef");
  const { data: ovAfter } = await a.client.from("recurring_overrides")
    .select("status").eq("series_key", "deadbeef").single();
  check("recurring_overrides: cross-user update is a no-op", ovAfter?.status === "dismissed");

  const { error: ovDeleteOwn } = await a.client.from("recurring_overrides")
    .delete().eq("user_id", a.id).eq("series_key", "deadbeef");
  check("recurring_overrides: owner can delete", !ovDeleteOwn, ovDeleteOwn?.message ?? "");

  // ---- Balance anchoring slice: balance_anchors isolation ----
  const { error: baInsertOwn } = await a.client.from("balance_anchors")
    .insert({ user_id: a.id, account_id: acct!.id, anchor_date: "2026-07-31", balance: 1500, source: "manual" });
  check("balance_anchors: owner can insert", !baInsertOwn, baInsertOwn?.message ?? "");

  const { data: baCrossRead } = await b.client.from("balance_anchors").select("id");
  check("balance_anchors: cross-user read returns nothing", (baCrossRead ?? []).length === 0);

  const { error: baForge } = await b.client.from("balance_anchors")
    .insert({ user_id: a.id, account_id: acct!.id, anchor_date: "2026-07-31", balance: 9999, source: "manual" });
  check("balance_anchors: cross-user insert rejected", !!baForge);

  await b.client.from("balance_anchors")
    .update({ balance: 0 }).eq("user_id", a.id);
  const { data: baAfter } = await a.client.from("balance_anchors")
    .select("balance").eq("account_id", acct!.id).single();
  check("balance_anchors: cross-user update is a no-op", Number(baAfter?.balance) === 1500);

  const { error: baDeleteOwn } = await a.client.from("balance_anchors")
    .delete().eq("user_id", a.id).eq("account_id", acct!.id);
  check("balance_anchors: owner can delete", !baDeleteOwn, baDeleteOwn?.message ?? "");

  // Trigger check: A can't anchor an account that isn't theirs, even with their own user_id.
  const { data: bAcct, error: bAcctErr } = await b.client.from("financial_accounts")
    .insert({ user_id: b.id, provider: "manual", type: "checking", display_name: "B checking" })
    .select("id").single();
  check("B can insert own account", !bAcctErr && !!bAcct, bAcctErr?.message);

  const { error: baForgedAccountErr } = await a.client.from("balance_anchors")
    .insert({ user_id: a.id, account_id: bAcct!.id, anchor_date: "2026-07-31", balance: 1, source: "manual" });
  check("balance_anchors: cannot anchor an account that isn't yours (ownership trigger)", !!baForgedAccountErr);

  // ---- Password auth slice: user_agreements isolation ----
  const { error: uaInsertOwn } = await a.client.from("user_agreements")
    .insert({ user_id: a.id, document: "terms", version: "test-rls" });
  check("user_agreements: owner can insert", !uaInsertOwn, uaInsertOwn?.message ?? "");

  const { data: uaCrossRead } = await b.client.from("user_agreements").select("id");
  check("user_agreements: cross-user read returns nothing", (uaCrossRead ?? []).length === 0);

  const { error: uaForge } = await b.client.from("user_agreements")
    .insert({ user_id: a.id, document: "privacy", version: "test-rls" });
  check("user_agreements: cross-user insert rejected", !!uaForge);

  // ai_narrations: owner-only cache/audit rows.
  const narrationRow = {
    user_id: a.id, surface: "performance_brief", input_hash: "t".repeat(64),
    input_json: { surface: "performance_brief" }, output_json: { body: "x".repeat(40), referencedDriverIds: [] },
    model: "test-model",
  };
  const { error: nIns } = await a.client.from("ai_narrations").insert(narrationRow);
  check("A can insert own narration", !nIns, nIns?.message);

  const { data: nOwn } = await a.client.from("ai_narrations").select("id").eq("user_id", a.id);
  check("A can read own narration", (nOwn?.length ?? 0) === 1);

  const { data: nCross } = await b.client.from("ai_narrations").select("id");
  check("B cannot read A's narrations", (nCross?.length ?? 0) === 0);

  const { error: nForge } = await b.client.from("ai_narrations")
    .insert({ ...narrationRow, input_hash: "u".repeat(64) });
  check("B cannot insert a narration for A", !!nForge);

  const { data: nUpd } = await b.client.from("ai_narrations")
    .update({ model: "evil" }).eq("user_id", a.id).select("id");
  check("B cannot update A's narrations", (nUpd?.length ?? 0) === 0);

  const { data: nDel } = await b.client.from("ai_narrations")
    .delete().eq("user_id", a.id).select("id");
  check("B cannot delete A's narrations", (nDel?.length ?? 0) === 0);

  // Phase 4 slice 2: the driver_explanations surface is accepted; junk is not.
  const { error: nDriverIns } = await a.client.from("ai_narrations").insert({
    ...narrationRow,
    surface: "driver_explanations",
    input_hash: "v".repeat(64),
    output_json: { explanations: [{ driverId: "d1", body: "x".repeat(40) }] },
  });
  check("A can insert a driver_explanations narration", !nDriverIns, nDriverIns?.message);

  const { error: nBadSurface } = await a.client.from("ai_narrations").insert({
    ...narrationRow,
    surface: "not_a_surface",
    input_hash: "w".repeat(64),
  });
  check("unknown surface value rejected by check constraint", !!nBadSurface);
} finally {
  if (a) {
    try {
      await admin.auth.admin.deleteUser(a.id);
    } catch (err) {
      console.error(`cleanup: failed to delete user A: ${(err as Error).message}`);
    }
  }
  if (b) {
    try {
      await admin.auth.admin.deleteUser(b.id);
    } catch (err) {
      console.error(`cleanup: failed to delete user B: ${(err as Error).message}`);
    }
  }
}

console.log(failures === 0 ? "\nRLS isolation: ALL CHECKS PASSED" : `\nRLS isolation: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
