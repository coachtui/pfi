import { describe, expect, it } from "vitest";
import { serviceRoleKey } from "./env.server";

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
