import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getImportContext, getProfile } from "@/lib/data/queries";
import { ImportWizard } from "./ImportWizard";

export default async function ImportPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const { accounts, existing } = await getImportContext(supabase);
  return <ImportWizard accounts={accounts} existing={existing} />;
}
