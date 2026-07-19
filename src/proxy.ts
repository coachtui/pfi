import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/config/env";
import { AGREED_COOKIE, agreedCookieValue } from "@/lib/legal/versions";
import { missingAgreements } from "@/lib/legal/consent";

const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/terms", "/privacy"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Required between createServerClient and any response logic — refreshes the session.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Consent gate: one DB query per session (cookie-cached), not per request.
  // The cookie only skips the *check* — proof of consent is the DB rows.
  if (user && !isPublic && !path.startsWith("/consent")) {
    if (request.cookies.get(AGREED_COOKIE)?.value !== agreedCookieValue(user.id)) {
      const { data: rows } = await supabase
        .from("user_agreements")
        .select("document, version")
        .eq("user_id", user.id);
      if (missingAgreements(rows ?? []).length > 0) {
        const url = request.nextUrl.clone();
        url.pathname = "/consent";
        return NextResponse.redirect(url);
      }
      response.cookies.set(AGREED_COOKIE, agreedCookieValue(user.id), {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
