import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

/**
 * PKCE code-exchange redemption. Requires the code_verifier cookie set by
 * the same browser storage that initiated the request — broken whenever the
 * emailed link is opened in a different browser/app than the one that
 * requested it (e.g. an installed iOS PWA vs. Safari, where email links
 * always open). Still the live path for password-reset and signup-
 * confirmation emails today (their redirectTo/emailRedirectTo values still
 * point here) — /auth/confirm is the device-independent replacement, wired
 * up once the Supabase dashboard's email templates are switched to its
 * token_hash format. After that switch, nothing in this codebase generates
 * a link pointing here, but it's kept as a landing spot for the ?code= shape
 * (e.g. a future OAuth provider).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const safeNext = safeRedirectPath(searchParams.get("next"));
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
