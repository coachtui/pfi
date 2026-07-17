"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { onboardingSchema, type OnboardingValues } from "@/lib/validation/onboarding";
import { loadDemoData } from "./demo";

export async function completeOnboarding(values: OnboardingValues): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = onboardingSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  // Re-entrant: a user who half-completed onboarding earlier (profile exists,
  // company insert failed) should be able to retry without hitting the
  // profile's primary-key uniqueness violation.
  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!existingProfile) {
    const { error: profileErr } = await supabase.from("user_profiles").insert({
      id: user.id, username: v.username, age_cohort: v.ageCohort, income_band: v.incomeBand,
      household_type: v.householdType, col_cohort: v.colCohort, objective: v.objective,
    });
    if (profileErr) {
      return { error: profileErr.code === "23505" ? "That username is taken." : profileErr.message };
    }
  }

  const { error: companyErr } = await supabase.from("personal_companies").insert({
    user_id: user.id, name: v.companyName, ticker: `$${v.ticker}`,
  });
  // 23505 (unique user_id) means the company already exists from a prior
  // half-completed attempt or a double-submit — treat as success and proceed
  // to stamping completion instead of failing the retry.
  if (companyErr && companyErr.code !== "23505") return { error: companyErr.message };

  // Only stamp onboarding as complete once the company exists, so a failure
  // above never leaves the user "completed" with no company (which would
  // otherwise cause an infinite redirect loop between "/" and "/onboarding").
  const { error: updErr } = await supabase
    .from("user_profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);
  if (updErr) return { error: updErr.message };

  if (v.loadDemo) {
    const demo = await loadDemoData();
    if (demo.error) return { error: demo.error };
  }
  redirect("/");
}
