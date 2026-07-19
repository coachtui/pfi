/**
 * Server-only env. Validated lazily (at first use, not import) so client
 * bundles and builds without the key still succeed — only the auth actions
 * that need service-role access fail loudly if it's absent.
 */
export function serviceRoleKey(source: Partial<NodeJS.ProcessEnv> = process.env): string {
  const key = source.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for auth actions. Set it in .env.local (dev) and the Vercel project env (production).",
    );
  }
  return key;
}
