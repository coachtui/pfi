import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export interface PasswordUser {
  email: string;
  username: string;
  password: string;
  userId: string;
}

/**
 * Mints a confirmed user with a password, an onboarded profile (so username
 * login resolves), and optionally consent rows (omit to exercise the gate).
 */
export async function createPasswordUser(opts: { consent: boolean }): Promise<PasswordUser> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, service);

  const suffix = randomUUID().slice(0, 8);
  const email = `e2e-pw-${suffix}@example.com`;
  const username = `e2e_pw_${suffix}`;
  const password = `pw-${suffix}-Aa1`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);

  const { error: profileErr } = await admin.from("user_profiles").insert({
    id: created.user.id,
    username,
    age_cohort: "30–39",
    income_band: "$50k–$100k",
    household_type: "Single",
    col_cohort: "Mid-Cost Region",
    objective: "reduce_debt",
    onboarding_completed_at: new Date().toISOString(),
  });
  if (profileErr) throw new Error(`profile insert failed: ${profileErr.message}`);

  // Without a company row, HomePage's onboarding-completeness check redirects
  // to /onboarding instead of the dashboard, which would make login specs
  // land somewhere other than "/" (the brief's fixture omitted this, which
  // let "logs in with ..." specs pass only via a transient URL match while
  // en route to /onboarding — this makes the landing genuine).
  const { error: companyErr } = await admin.from("personal_companies").insert({
    user_id: created.user.id,
    name: `${username} Holdings`,
    ticker: "E2E",
  });
  if (companyErr) throw new Error(`company insert failed: ${companyErr.message}`);

  if (opts.consent) {
    const { error: consentErr } = await admin.from("user_agreements").insert([
      { user_id: created.user.id, document: "terms", version: "2026-07-19" },
      { user_id: created.user.id, document: "privacy", version: "2026-07-19" },
    ]);
    if (consentErr) throw new Error(`consent insert failed: ${consentErr.message}`);
  }
  return { email, username, password, userId: created.user.id };
}

export async function deletePasswordUser(userId: string): Promise<void> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  await admin.auth.admin.deleteUser(userId);
}
