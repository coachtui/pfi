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

const a = await makeUser("a");
const b = await makeUser("b");

try {
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
  const { data: readProfiles } = await b.client.from("user_profiles").select("*").eq("id", a.id);
  check("B cannot read A's profile", (readProfiles ?? []).length === 0);

  const { data: readAccounts } = await b.client.from("financial_accounts").select("*").eq("user_id", a.id);
  check("B cannot read A's accounts", (readAccounts ?? []).length === 0);

  const { error: forgeErr } = await b.client.from("financial_accounts")
    .insert({ user_id: a.id, provider: "manual", type: "checking", display_name: "forged" });
  check("B cannot insert rows owned by A", !!forgeErr);

  const { data: updated } = await b.client.from("financial_accounts")
    .update({ display_name: "hacked" }).eq("id", acct!.id).select();
  check("B cannot update A's account", (updated ?? []).length === 0);

  const { data: deleted } = await b.client.from("financial_accounts")
    .delete().eq("id", acct!.id).select();
  check("B cannot delete A's account", (deleted ?? []).length === 0);

  const { data: snapForge } = await b.client.from("daily_snapshots")
    .insert({
      user_id: a.id, date: "2026-01-01", liquid_assets: 0, revolving_balances: 0,
      near_term_obligations: 0, essential_obligations: 0, safety_buffer: 0, net_worth: 0,
      engine_version: "test",
    }).select();
  check("B cannot insert snapshots for A", (snapForge ?? []).length === 0 || snapForge === null);

  const anonClient = createClient(url, anonKey);
  const { data: anonRead } = await anonClient.from("user_profiles").select("*");
  check("Unauthenticated client reads nothing", (anonRead ?? []).length === 0);
} finally {
  await admin.auth.admin.deleteUser(a.id);
  await admin.auth.admin.deleteUser(b.id);
}

console.log(failures === 0 ? "\nRLS isolation: ALL CHECKS PASSED" : `\nRLS isolation: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
