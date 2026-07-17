"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { DEMO_GENERATORS } from "@/lib/demo-data/generators";
import { DEFAULT_PROFILE_ID, isDemoProfileId } from "@/lib/demo-data/profiles";
import { demoAccountToRow, demoTransactionToRow, eventToRow, snapshotToRow } from "@/lib/data/mappers";
import { buildDailySnapshots } from "@/lib/financial-engine";
import { insertChunked } from "@/lib/data/insert-chunked";
import { rebuildSnapshots } from "@/lib/data/rebuild-snapshots";

export async function loadDemoData(profileId?: unknown): Promise<{ error: string }> {
  const id = isDemoProfileId(profileId) ? profileId : DEFAULT_PROFILE_ID;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    // Idempotent: clear any prior demo rows so a re-seed (or a profile
    // switch) can't violate the daily_snapshots PK or duplicate accounts.
    await clearDemoRows(supabase, user.id);

    const { accounts, transactions, events, config } = DEMO_GENERATORS[id]();

    // Accounts first (need their DB ids for transactions).
    const accountRows = accounts.map((a) => demoAccountToRow(user.id, a));
    const { data: insertedAccounts, error: accErr } = await supabase
      .from("financial_accounts").insert(accountRows).select("id, display_name");
    if (accErr) return { error: `insert accounts failed: ${accErr.message}` };

    const accountIdMap = new Map<string, string>();
    for (const a of accounts) {
      const match = (insertedAccounts ?? []).find((r) => r.display_name === a.displayName);
      if (!match) return { error: `demo seed: no inserted account matching "${a.displayName}"` };
      accountIdMap.set(a.id, match.id);
    }

    // Pre-allocate txn uuids so transfer pairs stay linked.
    const txnIdMap = new Map(transactions.map((t) => [t.id, randomUUID()]));
    await insertChunked(
      supabase, "transactions",
      transactions.map((t) => demoTransactionToRow(user.id, accountIdMap, txnIdMap, t)),
    );
    await insertChunked(supabase, "financial_events", events.map((e) => eventToRow(user.id, e)));

    const snapshots = buildDailySnapshots(accounts, transactions, config);
    await insertChunked(supabase, "daily_snapshots", snapshots.map((s) => snapshotToRow(user.id, s)));

    // A user may have manual accounts alongside demo data; the demo-built
    // snapshots above only cover demo accounts. Rebuilding from the DB folds
    // every active account in (identical output when only demo data exists).
    const { error: rebuildErr } = await rebuildSnapshots(supabase);
    if (rebuildErr) return { error: rebuildErr };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Loading demo data failed" };
  }

  revalidatePath("/");
  return { error: "" };
}

async function clearDemoRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<void> {
  // Transactions cascade from accounts. Events are demo-only today (no source
  // column yet — see KNOWN_LIMITATIONS); snapshots are derived and rebuilt.
  const del1 = await supabase.from("financial_accounts").delete().eq("provider", "demo").eq("user_id", userId);
  if (del1.error) throw new Error(del1.error.message);
  const del2 = await supabase.from("financial_events").delete().eq("user_id", userId);
  if (del2.error) throw new Error(del2.error.message);
  const del3 = await supabase.from("daily_snapshots").delete().eq("user_id", userId);
  if (del3.error) throw new Error(del3.error.message);
}

export async function clearDemoData(): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    await clearDemoRows(supabase, user.id);
    const { error: rebuildErr } = await rebuildSnapshots(supabase);
    if (rebuildErr) return { error: rebuildErr };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Clearing demo data failed" };
  }

  revalidatePath("/");
  return { error: "" };
}
