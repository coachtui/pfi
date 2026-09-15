import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Items that count toward the per-user cap: everything not fully disconnected (a pending disconnect is still billable). */
export async function countActiveItems(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase.from("plaid_items").select("id", { count: "exact", head: true })
    .eq("user_id", userId).neq("status", "disconnected");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export function capMessage(maxItems: number): string {
  return `You've reached the limit of ${maxItems} connected institution${maxItems === 1 ? "" : "s"}. Disconnect one to connect another.`;
}
