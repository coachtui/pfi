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
