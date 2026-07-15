import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/config/env";

/** Browser-side Supabase client. Use only in client components (login form). */
export function createClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
