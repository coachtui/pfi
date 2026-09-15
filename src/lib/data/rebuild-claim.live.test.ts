/**
 * Rebuild lease semantics (spec §5 step 7, acceptance criterion §13.5), live
 * against the linked Supabase project: exactly one of two concurrent
 * claimants wins, release is token-scoped, and a stale holder can never
 * clear a newer lease. Requires the Supabase env vars in .env.local.
 */
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { REBUILD_LEASE_MS, claimRebuild, releaseRebuild } from "./rebuild-claim";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("rebuild lease (live Supabase)", () => {
  let admin: SupabaseClient;
  let userClient: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    if (!url || !anonKey || !serviceKey) throw new Error("rebuild-claim.live.test.ts needs the Supabase env vars in .env.local");
    admin = createSupabaseClient(url, serviceKey);
    const email = `lease-live-${randomUUID().slice(0, 8)}@example.com`;
    const password = `Test-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    userId = data.user.id;
    userClient = createSupabaseClient(url, anonKey);
    const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);
    const { error: profileErr } = await userClient.from("user_profiles").insert({
      id: userId, username: `lease_${randomUUID().slice(0, 6)}`, age_cohort: "30–39", income_band: "$50k–$100k",
      household_type: "Single", col_cohort: "Mid-Cost Region", objective: "reduce_debt",
    });
    if (profileErr) throw new Error(`profile insert failed: ${profileErr.message}`);
  }, 60_000);

  afterAll(async () => {
    if (admin && userId) await admin.auth.admin.deleteUser(userId).catch((e: Error) => console.error(`cleanup: ${e.message}`));
  });

  it("exactly one of two concurrent claims wins; release is token-scoped", async () => {
    const [a, b] = await Promise.all([claimRebuild(userClient, userId), claimRebuild(userClient, userId)]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    const token = winners[0] as string;
    expect(await releaseRebuild(userClient, userId, randomUUID())).toBe(false); // wrong token: no-op
    expect(await releaseRebuild(userClient, userId, token)).toBe(true);
    const { data } = await userClient.from("user_profiles").select("rebuild_claim_token, rebuild_claimed_at").eq("id", userId).single();
    expect(data?.rebuild_claim_token).toBeNull();
    expect(data?.rebuild_claimed_at).toBeNull();
  });

  it("a stale holder cannot clear or overwrite a newer lease (§13.5)", async () => {
    const tokenA = await claimRebuild(userClient, userId);
    expect(tokenA).toBeTruthy();
    // Age A's lease past expiry (admin: simulates a worker that outran the lease).
    const expired = new Date(Date.now() - REBUILD_LEASE_MS - 60_000).toISOString();
    await admin.from("user_profiles").update({ rebuild_claimed_at: expired }).eq("id", userId);

    const tokenB = await claimRebuild(userClient, userId);
    expect(tokenB).toBeTruthy();
    expect(tokenB).not.toBe(tokenA);

    // A finishes late and releases: matches zero rows.
    expect(await releaseRebuild(userClient, userId, tokenA as string)).toBe(false);
    const { data: held } = await userClient.from("user_profiles").select("rebuild_claim_token").eq("id", userId).single();
    expect(held?.rebuild_claim_token).toBe(tokenB);

    expect(await releaseRebuild(userClient, userId, tokenB as string)).toBe(true);
  });
});
