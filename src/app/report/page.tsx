import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCompany, getProfile, getReportData } from "@/lib/data/queries";
import { ReportView } from "./ReportView";

export default async function ReportPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const company = await getCompany(supabase);
  if (!company) redirect("/onboarding");

  const { snapshots, transactions, events } = await getReportData(supabase);

  return (
    <ReportView
      companyName={company.name}
      ticker={company.ticker}
      snapshots={snapshots}
      transactions={transactions}
      events={events}
    />
  );
}
