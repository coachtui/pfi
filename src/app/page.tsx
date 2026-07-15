import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany, getDashboardData, getProfile } from "@/lib/data/queries";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { EmptyDashboard } from "@/components/dashboard/EmptyDashboard";
import { SignOutButton } from "@/components/nav/SignOutButton";

export default async function HomePage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const company = await getCompany(supabase);
  if (!company) redirect("/onboarding");

  const { snapshots, events } = await getDashboardData(supabase);

  return (
    <div className="flex flex-col gap-6">
      {snapshots.length === 0 ? (
        <EmptyDashboard companyName={company.name} />
      ) : (
        <HomeDashboard
          profile={{ companyName: company.name, ticker: company.ticker, username: profile.username }}
          snapshots={snapshots}
          events={events}
        />
      )}
      <div className="flex justify-end">
        <SignOutButton />
      </div>
    </div>
  );
}
