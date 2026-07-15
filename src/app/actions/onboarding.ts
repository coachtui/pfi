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

  const { error: profileErr } = await supabase.from("user_profiles").insert({
    id: user.id, username: v.username, age_cohort: v.ageCohort, income_band: v.incomeBand,
    household_type: v.householdType, col_cohort: v.colCohort, objective: v.objective,
    onboarding_completed_at: new Date().toISOString(),
  });
  if (profileErr) {
    return { error: profileErr.code === "23505" ? "That username is taken." : profileErr.message };
  }

  const { error: companyErr } = await supabase.from("personal_companies").insert({
    user_id: user.id, name: v.companyName, ticker: `$${v.ticker}`,
  });
  if (companyErr) return { error: companyErr.message };

  if (v.loadDemo) await loadDemoData();
  redirect("/");
}
