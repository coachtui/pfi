import { describe, expect, it } from "vitest";
import { plaidConfig, serviceRoleKey } from "./env.server";

describe("serviceRoleKey", () => {
  it("returns the key when set", () => {
    expect(serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "sk-test" } as Partial<NodeJS.ProcessEnv>)).toBe("sk-test");
  });

  it("throws a descriptive error when missing", () => {
    expect(() => serviceRoleKey({} as Partial<NodeJS.ProcessEnv>)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("throws when empty string", () => {
    expect(() => serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "" } as Partial<NodeJS.ProcessEnv>)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY2 = Buffer.alloc(32, 9).toString("base64");
const full = {
  PLAID_CLIENT_ID: "client-id",
  PLAID_SECRET: "secret",
  PLAID_TOKEN_ENCRYPTION_KEY: KEY,
} as Partial<NodeJS.ProcessEnv>;

describe("plaidConfig", () => {
  it("returns null when nothing is configured (feature disabled)", () => {
    expect(plaidConfig({} as Partial<NodeJS.ProcessEnv>)).toBeNull();
  });

  it("treats empty strings as unset", () => {
    expect(plaidConfig({ PLAID_CLIENT_ID: "", PLAID_SECRET: "" } as Partial<NodeJS.ProcessEnv>)).toBeNull();
  });

  it("throws naming the missing vars on a partial configuration", () => {
    expect(() => plaidConfig({ PLAID_CLIENT_ID: "client-id" } as Partial<NodeJS.ProcessEnv>)).toThrow(
      /missing PLAID_SECRET, PLAID_TOKEN_ENCRYPTION_KEY/,
    );
    expect(() => plaidConfig({ PLAID_SECRET: "secret", PLAID_TOKEN_ENCRYPTION_KEY: KEY } as Partial<NodeJS.ProcessEnv>)).toThrow(
      /missing PLAID_CLIENT_ID/,
    );
  });

  it("defaults the environment to sandbox", () => {
    expect(plaidConfig(full)?.environment).toBe("sandbox");
  });

  it("accepts production and rejects anything else", () => {
    expect(plaidConfig({ ...full, PLAID_ENV: "production" })?.environment).toBe("production");
    expect(() => plaidConfig({ ...full, PLAID_ENV: "development" })).toThrow(/PLAID_ENV/);
  });

  it("decodes the 32-byte base64 token key", () => {
    const cfg = plaidConfig(full)!;
    expect(cfg.tokenKey).toHaveLength(32);
    expect(cfg.tokenKey[0]).toBe(7);
    expect(cfg.previousTokenKey).toBeNull();
  });

  it("rejects a token key that is not 32 bytes", () => {
    expect(() => plaidConfig({ ...full, PLAID_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") })).toThrow(
      /exactly 32 bytes/,
    );
    expect(() => plaidConfig({ ...full, PLAID_TOKEN_ENCRYPTION_KEY: "not-base64!!" })).toThrow(/PLAID_TOKEN_ENCRYPTION_KEY/);
  });

  it("decodes the optional previous key with the same validation", () => {
    expect(plaidConfig({ ...full, PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS: KEY2 })?.previousTokenKey?.[0]).toBe(9);
    expect(() => plaidConfig({ ...full, PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS: "short" })).toThrow(
      /PLAID_TOKEN_ENCRYPTION_KEY_PREVIOUS/,
    );
  });

  it("returns client id and secret verbatim", () => {
    const cfg = plaidConfig(full)!;
    expect(cfg.clientId).toBe("client-id");
    expect(cfg.secret).toBe("secret");
  });
});
