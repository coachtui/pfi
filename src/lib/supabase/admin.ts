import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/config/env";
import { serviceRoleKey } from "@/lib/config/env.server";

/**
 * Service-role Supabase client. Bypasses RLS — server-side only, never
 * import from a client component. Used exclusively for: (1) resolving
 * username → email before authentication, (2) recording sign-up consent
 * for a not-yet-verified user.
 */
export function createAdminClient() {
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
