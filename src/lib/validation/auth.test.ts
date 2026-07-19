import { describe, expect, it } from "vitest";
import {
  escapeLikePattern,
  loginSchema,
  signupSchema,
  updatePasswordSchema,
} from "./auth";

describe("signupSchema", () => {
  it("accepts a valid signup", () => {
    expect(
      signupSchema.safeParse({ email: "a@b.com", password: "longenough", consent: true }).success,
    ).toBe(true);
  });

  it("rejects passwords under 8 chars", () => {
    expect(signupSchema.safeParse({ email: "a@b.com", password: "short", consent: true }).success).toBe(false);
  });

  it("rejects passwords over 72 chars (bcrypt limit)", () => {
    expect(
      signupSchema.safeParse({ email: "a@b.com", password: "x".repeat(73), consent: true }).success,
    ).toBe(false);
  });

  it("rejects missing consent", () => {
    expect(signupSchema.safeParse({ email: "a@b.com", password: "longenough", consent: false }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts email or username identifiers", () => {
    expect(loginSchema.safeParse({ identifier: "a@b.com", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "IslandBuilder", password: "x" }).success).toBe(true);
  });

  it("rejects empty fields", () => {
    expect(loginSchema.safeParse({ identifier: "", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: "a@b.com", password: "" }).success).toBe(false);
  });

  it("trims the identifier", () => {
    const parsed = loginSchema.parse({ identifier: "  tui  ", password: "x" });
    expect(parsed.identifier).toBe("tui");
  });
});

describe("updatePasswordSchema", () => {
  it("enforces the same password rules", () => {
    expect(updatePasswordSchema.safeParse({ password: "short" }).success).toBe(false);
    expect(updatePasswordSchema.safeParse({ password: "longenough" }).success).toBe(true);
  });
});

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards so underscores match literally", () => {
    // Without escaping, ilike("a_c") would also match "abc".
    expect(escapeLikePattern("a_c")).toBe("a\\_c");
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("plain")).toBe("plain");
  });
});
