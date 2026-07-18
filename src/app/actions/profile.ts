"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Snooze the staleness banner. It returns on its own if the data is still
 * stale a full cycle (35 days) later — see nudgeVisible in the engine. */
export async function dismissStaleNudge(): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("user_profiles")
    .update({ stale_nudge_dismissed_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { error: "" };
}
