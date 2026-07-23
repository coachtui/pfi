"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isKnownPresetId } from "@/lib/config/company-presets";
import { companyProfileSchema, type CompanyProfileValues } from "@/lib/validation/company-profile";

export async function updateCompanyProfile(values: CompanyProfileValues): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = companyProfileSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  // logoPath shape is already validated as `preset:<id>` | null; additionally
  // reject a well-formed tag whose id isn't a real preset.
  if (v.logoPath !== null && !isKnownPresetId(v.logoPath.slice("preset:".length))) {
    return { error: "Unknown emblem" };
  }

  // Username lives on user_profiles and is unique; map the uniqueness
  // violation to a friendly message. Updating to the current (unchanged)
  // username targets the same row and cannot collide.
  const { error: profileErr } = await supabase
    .from("user_profiles")
    .update({ username: v.username })
    .eq("id", user.id);
  if (profileErr) {
    return { error: profileErr.code === "23505" ? "That username is taken." : profileErr.message };
  }

  const { error: companyErr } = await supabase
    .from("personal_companies")
    .update({ name: v.companyName, ticker: `$${v.ticker}`, logo_path: v.logoPath })
    .eq("user_id", user.id);
  if (companyErr) return { error: companyErr.message };

  revalidatePath("/");
  return {};
}
