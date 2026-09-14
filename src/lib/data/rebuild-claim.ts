import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-user rebuild lease (spec §5 step 7, acceptance criterion §13.5).
 * Dashboard-load repair claims the lease with a fresh token via ONE
 * conditional update; a zero-row result means another tab or refresh holds a
 * live lease. Release is token-scoped, so a worker that outran the lease can
 * never clear or overwrite a newer worker's claim.
 */
export const REBUILD_LEASE_MS = 2 * 60 * 1000;

export async function claimRebuild(supabase: SupabaseClient, userId: string, now: Date = new Date()): Promise<string | null> {
  const token = randomUUID();
  const expiredBefore = new Date(now.getTime() - REBUILD_LEASE_MS).toISOString();
  const { data, error } = await supabase.from("user_profiles")
    .update({ rebuild_claim_token: token, rebuild_claimed_at: now.toISOString() })
    .eq("id", userId)
    .or(`rebuild_claimed_at.is.null,rebuild_claimed_at.lt.${expiredBefore}`)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) === 1 ? token : null;
}

export async function releaseRebuild(supabase: SupabaseClient, userId: string, token: string): Promise<boolean> {
  const { data, error } = await supabase.from("user_profiles")
    .update({ rebuild_claim_token: null, rebuild_claimed_at: null })
    .eq("id", userId)
    .eq("rebuild_claim_token", token)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) === 1;
}
