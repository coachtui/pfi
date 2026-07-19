/**
 * Validates a `next` redirect param as a same-site relative path — never an
 * absolute, protocol-relative, or backslash-containing URL (open-redirect
 * guard; backslashes can be normalized to `/` by some URL parsers). Falls
 * back to "/" for anything else. Shared between /auth/callback and
 * /auth/confirm, the two routes that redeem an emailed auth link.
 */
export function safeRedirectPath(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : "/";
}
