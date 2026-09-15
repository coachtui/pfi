import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountsData, getConnectedItems, getFreshnessData, getProfile, getRecentImports, getRecurringData } from "@/lib/data/queries";
import { plaidConfig } from "@/lib/config/env.server";
import { AccountsView } from "./AccountsView";
import type { PlaidUiConfig } from "./ConnectedInstitutionsCard";

export default async function AccountsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const [accounts, recentImports, recurring, freshness, connected] = await Promise.all([
    getAccountsData(supabase),
    getRecentImports(supabase),
    getRecurringData(supabase),
    getFreshnessData(supabase),
    getConnectedItems(supabase),
  ]);
  // A partial Plaid configuration throws (deployment mistake); the accounts
  // page degrades to "not configured" and logs rather than failing to render.
  let plaid: PlaidUiConfig | null = null;
  try {
    const cfg = plaidConfig();
    if (cfg) plaid = { maxItems: cfg.maxItems, environment: cfg.environment };
  } catch (e) {
    console.error(`[plaid] ${e instanceof Error ? e.message : "invalid configuration"}`);
  }
  return (
    <AccountsView
      accounts={accounts}
      recentImports={recentImports}
      recurring={recurring}
      asOfByAccount={freshness.asOfByAccount}
      connectedItems={connected.items}
      plaid={plaid}
    />
  );
}
