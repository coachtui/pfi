import { z } from "zod";

/**
 * Environment validation. All env access goes through this module so a
 * missing or malformed variable fails loudly at startup, not at runtime.
 *
 * Supabase is wired (Phase 1.5 infrastructure) — auth, persistence, RLS.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Phase 4 AI (optional — absent disables AI features; empty string = unset).
  AI_GATEWAY_API_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  PFI_AI_MODEL: z.string().min(1).default("anthropic/claude-haiku-4-5"),
});

export type Env = z.infer<typeof envSchema>;

// Next.js's bundler statically inlines `process.env.NEXT_PUBLIC_*` for the
// client bundle only when the property access is written literally — passing
// `process.env` through as a whole object (the previous default) opts the
// client build out of inlining, so NEXT_PUBLIC_* is always undefined in the
// browser. Building the default source object from literal accesses keeps
// this module safe to import from client components.
const defaultSource = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  PFI_AI_MODEL: process.env.PFI_AI_MODEL,
} as NodeJS.ProcessEnv;

export function validateEnv(source: NodeJS.ProcessEnv = defaultSource): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env =
  process.env.VITEST !== undefined
    ? envSchema.parse({
        NODE_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
      })
    : validateEnv();
