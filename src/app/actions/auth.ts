"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  escapeLikePattern,
  loginSchema,
  resetRequestSchema,
  signupSchema,
  updatePasswordSchema,
} from "@/lib/validation/auth";
import { CURRENT_AGREEMENTS } from "@/lib/legal/versions";
import { missingAgreements } from "@/lib/legal/consent";

export type AuthFormState = { error?: string; message?: string };

/** Identical for unknown username, unknown email, and wrong password — never reveals which. */
const INVALID_CREDENTIALS = "Invalid email/username or password.";

async function requestOrigin(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("origin") ?? "http://localhost:3000";
}

/**
 * Resolve a login identifier to an email. Usernames are looked up with the
 * service-role client (profiles are unreadable pre-auth under RLS) —
 * anonymous browsers can never run this query themselves.
 */
async function emailForIdentifier(identifier: string): Promise<string | null> {
  if (identifier.includes("@")) return identifier;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id")
    .ilike("username", escapeLikePattern(identifier))
    .maybeSingle();
  if (!profile) return null;
  const { data } = await admin.auth.admin.getUserById(profile.id);
  return data.user?.email ?? null;
}

export async function signInWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: INVALID_CREDENTIALS };

  const email = await emailForIdentifier(parsed.data.identifier);
  if (!email) return { error: INVALID_CREDENTIALS };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (error || !data.user) return { error: INVALID_CREDENTIALS };

  const { data: rows } = await supabase
    .from("user_agreements")
    .select("document, version")
    .eq("user_id", data.user.id);
  redirect(missingAgreements(rows ?? []).length > 0 ? "/consent" : "/");
}

export async function signUpWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    consent: formData.get("consent") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const origin = await requestOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: "Could not create the account. Try again." };

  // Supabase returns an obfuscated user with no identities when the email
  // already has an account. Only record consent for genuinely new users,
  // but report the identical message either way (no email enumeration).
  const isNewUser = (data.user?.identities?.length ?? 0) > 0;
  if (isNewUser && data.user) {
    const admin = createAdminClient();
    // Service-role insert: the user can't write their own rows yet (email
    // unverified, no session). The checkbox moment is the consent timestamp.
    const { error: consentError } = await admin.from("user_agreements").insert(
      CURRENT_AGREEMENTS.map((a) => ({
        user_id: data.user!.id,
        document: a.document,
        version: a.version,
      })),
    );
    if (consentError) return { error: "Could not create the account. Try again." };
  }
  return {
    message: `Check your email — we sent a verification link to ${parsed.data.email}.`,
  };
}

export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const origin = await requestOrigin();
  const supabase = await createClient();
  // Result deliberately ignored: the response must be identical whether or
  // not the email has an account.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset/update`,
  });
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = updatePasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link expired or was already used. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Could not update the password. Try again." };
  redirect("/");
}

export async function acceptAgreements(): Promise<AuthFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Authenticated insert under the user's own RLS; ignoreDuplicates makes
  // re-submits harmless.
  const { error } = await supabase.from("user_agreements").upsert(
    CURRENT_AGREEMENTS.map((a) => ({ user_id: user.id, document: a.document, version: a.version })),
    { onConflict: "user_id,document,version", ignoreDuplicates: true },
  );
  if (error) return { error: "Could not record your consent. Try again." };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
