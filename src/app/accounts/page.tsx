import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountsData, getProfile, getRecentImports } from "@/lib/data/queries";
import { AccountsView } from "./AccountsView";

export default async function AccountsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const [accounts, recentImports] = await Promise.all([
    getAccountsData(supabase),
    getRecentImports(supabase),
  ]);
  return <AccountsView accounts={accounts} recentImports={recentImports} />;
}
