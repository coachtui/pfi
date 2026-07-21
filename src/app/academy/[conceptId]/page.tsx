import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import { lessonConcept } from "@/lib/concepts/progress";
import { getAcademyProgress, getProfile } from "@/lib/data/queries";
import { LessonView } from "@/components/academy/LessonView";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ conceptId: string }>;
}) {
  const { conceptId } = await params;
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");

  // Unknown, unpublished, or glossary-only → 404 (comprehension still lives in the term sheet).
  if (!lessonConcept(CONCEPT_REGISTRY, conceptId)) notFound();

  const { rows } = await getAcademyProgress(supabase);
  const row = rows.find((r) => r.conceptId === conceptId);

  return (
    <LessonView
      conceptId={conceptId}
      initialResponses={row?.checkResponses ?? []}
      initialCompleted={!!row?.completedAt}
    />
  );
}
