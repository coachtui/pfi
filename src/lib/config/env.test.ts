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
    const rest: NodeJS.ProcessEnv = { ...valid };
    delete rest.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => validateEnv(rest)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when the anon key is empty", () => {
    expect(() =>
      validateEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" } as NodeJS.ProcessEnv),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe("AI config", () => {
  const base = {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-key",
  } as NodeJS.ProcessEnv;

  it("accepts a missing AI key and applies the model default", () => {
    const parsed = validateEnv(base);
    expect(parsed.AI_GATEWAY_API_KEY).toBeUndefined();
    expect(parsed.PFI_AI_MODEL).toBe("anthropic/claude-haiku-4-5");
  });

  it("treats an empty-string AI key as unset", () => {
    const parsed = validateEnv({ ...base, AI_GATEWAY_API_KEY: "" });
    expect(parsed.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  it("accepts a present AI key and model override", () => {
    const parsed = validateEnv({
      ...base,
      AI_GATEWAY_API_KEY: "vck_test",
      PFI_AI_MODEL: "anthropic/claude-sonnet-5",
    });
    expect(parsed.AI_GATEWAY_API_KEY).toBe("vck_test");
    expect(parsed.PFI_AI_MODEL).toBe("anthropic/claude-sonnet-5");
  });
});
