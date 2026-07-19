import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

/**
 * Device-independent email-link redemption via token_hash + verifyOtp,
 * instead of /auth/callback's ?code= + exchangeCodeForSession. The PKCE
 * code flow requires the code_verifier cookie set by the SAME browser
 * storage that initiated the request (resetPasswordForEmail/signUp) — which
 * fails when the request comes from one context (e.g. an installed iOS PWA)
 * and the emailed link is opened in a different one (e.g. Safari, since
 * email links never deep-link into installed PWAs on iOS). token_hash
 * carries the credential in the URL itself, so it redeems correctly
 * regardless of which browser opens it. Password-reset and signup-
 * confirmation emails must be configured (Supabase dashboard → Email
 * Templates) to link here instead of the default ConfirmationURL.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const safeNext = safeRedirectPath(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
