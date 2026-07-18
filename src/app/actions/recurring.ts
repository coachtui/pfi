"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import type { MutationResult } from "@/lib/validation/transactions";

const seriesKeySchema = z.string().regex(/^[0-9a-f]{8}$/);
const statusSchema = z.enum(["confirmed", "dismissed"]);

/**
 * Confirm or dismiss a detected recurring series. Snapshots must rebuild:
 * the override changes which series project into obligation windows beyond
 * known history, and those windows are persisted in daily_snapshots.
 */
export async function setRecurringOverride(seriesKey: string, status: "confirmed" | "dismissed"): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!seriesKeySchema.safeParse(seriesKey).success) return { error: "Invalid series" };
  if (!statusSchema.safeParse(status).success) return { error: "Invalid status" };

  const { error } = await supabase.from("recurring_overrides").upsert(
    { user_id: user.id, series_key: seriesKey, status, updated_at: new Date().toISOString() },
    { onConflict: "user_id,series_key" },
  );
  if (error) return { error: error.message };
  return finishWithRebuild(supabase);
}

/** Return a series to its default (detected, unreviewed) state. */
export async function clearRecurringOverride(seriesKey: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!seriesKeySchema.safeParse(seriesKey).success) return { error: "Invalid series" };

  const { error } = await supabase.from("recurring_overrides")
    .delete().eq("user_id", user.id).eq("series_key", seriesKey);
  if (error) return { error: error.message };
  return finishWithRebuild(supabase);
}
