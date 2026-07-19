import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { branding } from "@/lib/config/branding";
import { createClient } from "@/lib/supabase/server";
import { missingAgreements } from "@/lib/legal/consent";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { ConsentForm } from "./ConsentForm";

export const metadata: Metadata = { title: `Review terms — ${branding.productName}` };

export default async function ConsentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("user_agreements")
    .select("document, version")
    .eq("user_id", user.id);
  if (missingAgreements(rows ?? []).length === 0) redirect("/");

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">One thing before you continue</h1>
        <p className="mt-1 text-sm text-secondary">
          Please review and accept the current Terms of Service (v{TERMS_VERSION}) and Privacy
          Policy (v{PRIVACY_VERSION}).
        </p>
      </header>
      <ConsentForm />
    </div>
  );
}
