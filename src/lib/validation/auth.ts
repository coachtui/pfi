import { z } from "zod";

export const PASSWORD_MIN = 8;
/** 72 is bcrypt's input limit — longer passwords would be silently truncated. */
export const PASSWORD_MAX = 72;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or username"),
  password: z.string().min(1, "Enter your password"),
});

export const signupSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: passwordSchema,
  consent: z.literal(true, "You must agree to the Terms of Service and Privacy Policy"),
});

export const resetRequestSchema = z.object({
  email: z.email("Enter a valid email address"),
});

export const updatePasswordSchema = z.object({
  password: passwordSchema,
});

/**
 * Escape `%`, `_`, and `\` so a PostgREST ilike() does an exact
 * case-insensitive match. Usernames allow underscores, which are
 * single-char wildcards in LIKE patterns — unescaped, "a_c" matches "abc".
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
