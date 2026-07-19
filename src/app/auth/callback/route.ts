import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

/**
 * PKCE code-exchange redemption. Requires the code_verifier cookie set by
 * the same browser storage that initiated the request — see /auth/confirm
 * for the device-independent token_hash alternative used by email links
 * that may be opened in a different browser/app than the one that requested
 * them (e.g. an installed iOS PWA vs. Safari, where email links always
 * open). This route now only serves OAuth-provider-style ?code= exchanges.
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
