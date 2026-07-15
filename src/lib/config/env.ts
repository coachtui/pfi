import { z } from "zod";

/**
 * Environment validation. All env access goes through this module so a
 * missing or malformed variable fails loudly at startup, not at runtime.
 *
 * Supabase variables are optional until Phase 3 wires live auth/persistence
 * (Phase 0–1 run entirely on deterministic demo data). Once required, drop
 * `.optional()` and the build will enforce them.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = validateEnv();
