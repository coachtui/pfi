import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany, getDashboardData, getProfile } from "@/lib/data/queries";
import { rebuildSnapshots } from "@/lib/data/rebuild-snapshots";
import { VIEWER_LEVEL } from "@/lib/demo-data/cohorts";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { EmptyDashboard } from "@/components/dashboard/EmptyDashboard";
import { SignOutButton } from "@/components/nav/SignOutButton";

export default async function HomePage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const company = await getCompany(supabase);
  if (!company) redirect("/onboarding");

  let data = await getDashboardData(supabase);
  if (data.staleIndex) {
    // Idempotent reconciliation: a prior rebuild failed or was skipped. Safe in
    // a GET — rebuildSnapshots never calls revalidatePath and always converges.
    await rebuildSnapshots(supabase);
    data = await getDashboardData(supabase);
  }
  const { snapshots, events, staleIndex, scoreSummary } = data;

  return (
    <div className="flex flex-col gap-6">
      {snapshots.length === 0 ? (
        <EmptyDashboard companyName={company.name} />
      ) : (
        <HomeDashboard
          profile={{ companyName: company.name, ticker: company.ticker, username: profile.username, level: VIEWER_LEVEL }}
          snapshots={snapshots}
          events={events}
          scoreSummary={scoreSummary}
          staleIndex={staleIndex}
        />
      )}
      <div className="flex justify-end">
        <SignOutButton />
      </div>
    </div>
  );
}
