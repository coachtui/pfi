"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import {
  appendCheckResponse, lessonConcept, validateCheckAnswer, type CheckResponse,
} from "@/lib/concepts/progress";
import { getConceptLiveData, type ConceptLiveData } from "@/lib/data/concept-live";

/** Upsert the in-progress row. Idempotent — re-opening a lesson is a no-op. */
export async function startLesson(conceptId: string): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!lessonConcept(CONCEPT_REGISTRY, conceptId)) return { error: "Unknown lesson" };

  const { error } = await supabase.from("academy_progress").upsert(
    { user_id: user.id, concept_id: conceptId },
    { onConflict: "user_id,concept_id", ignoreDuplicates: true },
  );
  if (error) return { error: error.message };
  revalidatePath("/academy");
  return { error: "" };
}

export interface AnswerResult {
  error: string;
  responses?: CheckResponse[];
  completed?: boolean;
}

/**
 * Record one knowledge-check answer. First answer per check wins; when every
 * check of the lesson has a response, completed_at is set in the same call —
 * right or wrong (checks teach, never gate; spec §Product decisions #4).
 */
export async function answerKnowledgeCheck(
  conceptId: string,
  checkId: string,
  choiceIndex: number,
): Promise<AnswerResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const invalid = validateCheckAnswer(CONCEPT_REGISTRY, conceptId, checkId, choiceIndex);
  if (invalid) return { error: invalid };
  const concept = lessonConcept(CONCEPT_REGISTRY, conceptId)!;

  // RLS scopes the read to the caller's own rows.
  const { data: row, error: readErr } = await supabase
    .from("academy_progress")
    .select("check_responses, completed_at")
    .eq("concept_id", conceptId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const prior = (row?.check_responses as CheckResponse[] | null) ?? [];
  const { responses, allAnswered, duplicate } = appendCheckResponse(
    concept.lesson!.knowledgeChecks.length,
    prior,
    { checkId, choiceIndex },
  );
  if (duplicate) return { error: "", responses: prior, completed: !!row?.completed_at };

  const completedAt = row?.completed_at ?? (allAnswered ? new Date().toISOString() : null);
  const { error: writeErr } = await supabase.from("academy_progress").upsert(
    { user_id: user.id, concept_id: conceptId, check_responses: responses, completed_at: completedAt },
    { onConflict: "user_id,concept_id" },
  );
  if (writeErr) return { error: writeErr.message };

  if (completedAt && !row?.completed_at) {
    // Completion changes the layout-level completed-ids fetch (term-sheet variant).
    revalidatePath("/", "layout");
  } else {
    revalidatePath("/academy");
  }
  return { error: "", responses, completed: !!completedAt };
}

/** Lazy completed-state fetch for the definition sheet (spec decision #10). */
export async function getConceptLive(
  conceptId: string,
): Promise<{ error: string; data?: ConceptLiveData | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const c = CONCEPT_REGISTRY.byId(conceptId);
  if (!c || c.status !== "published" || !c.dataMetricKey) return { error: "", data: null };
  const data = await getConceptLiveData(supabase, c.dataMetricKey);
  return { error: "", data };
}
