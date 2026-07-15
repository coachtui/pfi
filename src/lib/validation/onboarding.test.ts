import { describe, expect, it } from "vitest";
import { onboardingSchema } from "./onboarding";

const valid = {
  companyName: "Koa Holdings", ticker: "KOAH", username: "IslandBuilder",
  ageCohort: "40–49", incomeBand: "$150k–$200k", householdType: "Couple",
  colCohort: "High-Cost Region", objective: "increase_liquidity", loadDemo: true,
};

describe("onboardingSchema", () => {
  it("accepts a valid payload", () => {
    expect(onboardingSchema.parse(valid)).toMatchObject({ ticker: "KOAH" });
  });

  it("uppercases and validates tickers", () => {
    expect(onboardingSchema.parse({ ...valid, ticker: "koah" }).ticker).toBe("KOAH");
    expect(() => onboardingSchema.parse({ ...valid, ticker: "TOOLONG1" })).toThrow();
  });

  it("rejects usernames with spaces or symbols", () => {
    expect(() => onboardingSchema.parse({ ...valid, username: "island builder" })).toThrow();
  });

  it("rejects unknown cohort values", () => {
    expect(() => onboardingSchema.parse({ ...valid, ageCohort: "exactly 43" })).toThrow();
  });
});
