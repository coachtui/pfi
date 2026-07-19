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
 * regardless of which browser opens it.
 *
 * NOT YET WIRED UP: password-reset and signup-confirmation emails still use
 * Supabase's default template (built from the app's redirectTo/
 * emailRedirectTo values, landing on /auth/callback). To switch a flow over,
 * edit its template in the Supabase dashboard (Auth → Email Templates) to:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset/update
 * (type=email for "Confirm signup", next=/ or omit it there). The next=
 * value must be a HARDCODED relative path, not {{ .RedirectTo }} — that
 * variable resolves to an absolute URL, which safeRedirectPath() below
 * rejects (open-redirect guard), stranding the user on "/" after a
 * successful verify instead of reaching the intended page.
 */
const VALID_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const typeParam = searchParams.get("type");
  const type = VALID_TYPES.find((t) => t === typeParam) ?? null;
  const safeNext = safeRedirectPath(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
