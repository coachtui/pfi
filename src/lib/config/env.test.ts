import { describe, expect, it } from "vitest";
import { validateEnv } from "./env";

const valid = {
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
} as NodeJS.ProcessEnv;

describe("validateEnv", () => {
  it("accepts a complete environment", () => {
    const env = validateEnv(valid);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("throws when Supabase URL is missing", () => {
    const { NEXT_PUBLIC_SUPABASE_URL: _omit, ...rest } = valid;
    expect(() => validateEnv(rest as NodeJS.ProcessEnv)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when the anon key is empty", () => {
    expect(() =>
      validateEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" } as NodeJS.ProcessEnv),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
