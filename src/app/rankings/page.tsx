import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany, getProfile } from "@/lib/data/queries";
import { getLeagues, VIEWER_LEVEL } from "@/lib/demo-data/cohorts";
import { RankingsView } from "./RankingsView";

export default async function RankingsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const company = await getCompany(supabase);
  if (!company) redirect("/onboarding");

  return (
    <RankingsView
      leagues={getLeagues()}
      identity={{
        companyName: company.name,
        ticker: company.ticker,
        username: profile.username,
        level: VIEWER_LEVEL,
      }}
    />
  );
}
