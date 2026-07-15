import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/queries";
import { branding } from "@/lib/config/branding";
import { OnboardingForm } from "./OnboardingForm";

export const metadata: Metadata = { title: `Get started — ${branding.productName}` };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (profile?.onboarding_completed_at) redirect("/");
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-primary">Create your personal company</h1>
        <p className="mt-1 text-sm text-secondary">
          Your finances, presented like a public company. Only your company name, ticker, and
          username can ever be visible to others — never your real identity or balances.
        </p>
      </header>
      <OnboardingForm />
    </div>
  );
}
