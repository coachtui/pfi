import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountsData, getProfile } from "@/lib/data/queries";
import { AccountsView } from "./AccountsView";

export default async function AccountsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const accounts = await getAccountsData(supabase);
  return <AccountsView accounts={accounts} />;
}
