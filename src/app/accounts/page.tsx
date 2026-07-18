import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountsData, getFreshnessData, getProfile, getRecentImports, getRecurringData } from "@/lib/data/queries";
import { AccountsView } from "./AccountsView";

export default async function AccountsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const [accounts, recentImports, recurring, freshness] = await Promise.all([
    getAccountsData(supabase),
    getRecentImports(supabase),
    getRecurringData(supabase),
    getFreshnessData(supabase),
  ]);
  return (
    <AccountsView
      accounts={accounts}
      recentImports={recentImports}
      recurring={recurring}
      asOfByAccount={freshness.asOfByAccount}
    />
  );
}
