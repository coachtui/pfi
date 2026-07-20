import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany, getDashboardData, getFreshnessData, getProfile } from "@/lib/data/queries";
import { getOrGenerateNarration } from "@/lib/data/narration";
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
  const freshness = await getFreshnessData(supabase);

  const narrationSource =
    snapshots.length > 0
      ? {
          companyName: company.name,
          snapshots,
          events,
          score:
            scoreSummary.overall !== null
              ? { overall: scoreSummary.overall, band: scoreSummary.band, momentum: scoreSummary.momentum }
              : null,
        }
      : null;

  // Not awaited: unwrapped inside Suspense boundaries via React use(); the
  // promises never reject (null = deterministic fallback).
  const narration = narrationSource
    ? getOrGenerateNarration(supabase, "performance_brief", narrationSource)
    : Promise.resolve(null);
  const driverNarration = narrationSource
    ? getOrGenerateNarration(supabase, "driver_explanations", narrationSource)
    : Promise.resolve(null);

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
          freshness={freshness}
          narration={narration}
          driverNarration={driverNarration}
        />
      )}
      <div className="flex justify-end">
        <SignOutButton />
      </div>
    </div>
  );
}
