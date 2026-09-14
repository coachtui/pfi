import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plaidConfig } from "@/lib/config/env.server";
import { syncAllItems } from "@/lib/plaid/sync";
import { claimRebuild, releaseRebuild } from "./rebuild-claim";
import { rebuildSnapshots } from "./rebuild-snapshots";

export const DASHBOARD_SYNC_AFTER_MS = 12 * 60 * 60 * 1000;

export interface DashboardPrep {
  /** A sync ran on this load (best-effort; failures never block render). */
  synced: boolean;
  /** A pending post-sync rebuild was repaired on this load. */
  repaired: boolean;
  /** Another tab holds the rebuild lease; the stale-index notice should show. */
  repairDeferred: boolean;
}

/**
 * Dashboard-load housekeeping (spec §9): (1) sync connected Items whose
 * newest sync is older than 12 hours; (2) repair any confirmed sync batch
 * whose rebuild never completed, under the per-user lease. Runs during a
 * render, so it never calls revalidatePath and never throws.
 */
export async function prepareDashboard(supabase: SupabaseClient, userId: string, now: Date = new Date()): Promise<DashboardPrep> {
  const prep: DashboardPrep = { synced: false, repaired: false, repairDeferred: false };
  if (!plaidConfig()) return prep;

  try {
    const { data: newest } = await supabase.from("plaid_items").select("last_synced_at")
      .in("status", ["initializing", "history_loading", "connected"])
      .order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const hasActive = newest !== null;
    const lastSynced = newest?.last_synced_at ? Date.parse(newest.last_synced_at as string) : null;
    if (hasActive && (lastSynced === null || now.getTime() - lastSynced > DASHBOARD_SYNC_AFTER_MS)) {
      await syncAllItems(supabase, userId, { revalidate: false });
      prep.synced = true;
    }
  } catch (e) {
    console.error(`[plaid] dashboard sync skipped: ${e instanceof Error ? e.message : "unknown"}`);
  }

  try {
    const { data: pending } = await supabase.from("import_batches").select("id")
      .eq("source_type", "connected_account").eq("status", "confirmed").is("rebuild_completed_at", null).limit(50);
    const pendingIds = ((pending ?? []) as { id: string }[]).map((b) => b.id);
    if (pendingIds.length === 0) return prep;

    const token = await claimRebuild(supabase, userId, now);
    if (!token) { prep.repairDeferred = true; return prep; }
    try {
      const { error } = await rebuildSnapshots(supabase);
      if (!error) {
        await supabase.from("import_batches").update({ rebuild_completed_at: new Date().toISOString() }).in("id", pendingIds);
        prep.repaired = true;
      }
    } finally {
      await releaseRebuild(supabase, userId, token);
    }
  } catch (e) {
    console.error(`[plaid] dashboard rebuild repair skipped: ${e instanceof Error ? e.message : "unknown"}`);
  }
  return prep;
}
