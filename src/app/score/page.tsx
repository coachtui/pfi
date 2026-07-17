import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getScoreData, type ScoreRange } from "@/lib/data/queries";
import { ScoreView } from "./ScoreView";

const RANGES: ScoreRange[] = ["30d", "90d", "1y", "all"];

export default async function ScorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");

  const sp = await searchParams;
  const range = RANGES.includes(sp.range as ScoreRange) ? (sp.range as ScoreRange) : "90d";
  const data = await getScoreData(supabase, range);

  return <ScoreView data={data} />;
}
