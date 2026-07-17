import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rebuildSnapshots } from "./rebuild-snapshots";
import type { MutationResult } from "@/lib/validation/transactions";

const REBUILD_WARNING =
  "Saved — but the index recalculation failed. It will retry on your next change or dashboard reload.";

/**
 * Common tail for every balance-affecting mutation: rebuild snapshots, then
 * revalidate every route that reads them. The write itself already
 * succeeded by the time this runs, so a rebuild failure is a warning, not
 * an error — the caller's data is safe either way.
 */
export async function finishWithRebuild(supabase: SupabaseClient): Promise<MutationResult> {
  const { error } = await rebuildSnapshots(supabase);
  revalidatePath("/");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/report");
  revalidatePath("/import");
  return error ? { error: "", warning: REBUILD_WARNING } : { error: "" };
}
