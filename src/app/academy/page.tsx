import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAcademyProgress, getProfile } from "@/lib/data/queries";
import { AcademyHome } from "@/components/academy/AcademyHome";

export default async function AcademyPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");

  const { rows, error } = await getAcademyProgress(supabase);
  return <AcademyHome rows={rows} degraded={error !== null} />;
}
