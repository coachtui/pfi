import { describe, expect, it } from "vitest";
import {
  NARRATION_SURFACE,
  narrationInputSchema,
  narrationOutputSchema,
  referencesOnlyKnownDrivers,
  bodyOnlyReferencesKnownAmounts,
  bodyDoesNotMislabelScore,
} from "./schemas";

const validInput = {
  surface: NARRATION_SURFACE,
  companyName: "Blue Reef Partners",
  periodDays: 30,
  availableCapital: 12450.75,
  cushion: 3200.5,
  vsBaseline: "above",
  vsWaterline: "above",
  momentum: { direction: "improving", delta: 2.3, windowDays: 7 },
  drivers: [
    { id: "d1", kind: "paycheck", date: "2026-07-15", impact: 4200, buildsEquity: false },
    { id: "d2", kind: "investment_contribution", date: "2026-07-10", impact: -500, buildsEquity: true },
  ],
  score: { overall: 612, band: "Solid", momentum: "improving" },
};

describe("narrationInputSchema", () => {
  it("accepts a valid input", () => {
    expect(narrationInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("rejects unknown fields (raw-data smuggling)", () => {
    expect(
      narrationInputSchema.safeParse({ ...validInput, transactions: [] }).success,
    ).toBe(false);
    expect(
      narrationInputSchema.safeParse({
        ...validInput,
        drivers: [{ ...validInput.drivers[0], label: "ACME PAYROLL" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a driver kind outside the event-type enum", () => {
    expect(
      narrationInputSchema.safeParse({
        ...validInput,
        drivers: [{ ...validInput.drivers[0], kind: "merchant_purchase" }],
      }).success,
    ).toBe(false);
  });

  it("allows a null score", () => {
    expect(narrationInputSchema.safeParse({ ...validInput, score: null }).success).toBe(true);
  });
});

describe("narrationOutputSchema", () => {
  it("accepts a valid output", () => {
    const out = {
      body: "Blue Reef Partners is trading above its baseline with $12,451 of available capital, lifted mainly by a $4,200 paycheck on Jul 15.",
      referencedDriverIds: ["d1"],
    };
    expect(narrationOutputSchema.parse(out)).toEqual(out);
  });

  it("rejects extra fields and out-of-bounds body length", () => {
    expect(
      narrationOutputSchema.safeParse({ body: "short", referencedDriverIds: [] }).success,
    ).toBe(false);
    expect(
      narrationOutputSchema.safeParse({
        body: "x".repeat(50),
        referencedDriverIds: [],
        advice: "buy stocks",
      }).success,
    ).toBe(false);
    expect(
      narrationOutputSchema.safeParse({ body: "x".repeat(701), referencedDriverIds: [] }).success,
    ).toBe(false);
  });
});

describe("referencesOnlyKnownDrivers", () => {
  const input = narrationInputSchema.parse(validInput);
  it("passes when all referenced ids exist", () => {
    expect(
      referencesOnlyKnownDrivers(input, { body: "x".repeat(50), referencedDriverIds: ["d1", "d2"] }),
    ).toBe(true);
  });
  it("fails on an invented driver id", () => {
    expect(
      referencesOnlyKnownDrivers(input, { body: "x".repeat(50), referencedDriverIds: ["d9"] }),
    ).toBe(false);
  });
});

describe("bodyOnlyReferencesKnownAmounts", () => {
  const input = narrationInputSchema.parse(validInput);

  it("passes when every dollar figure in the body matches a known input value", () => {
    const body =
      "Blue Reef Partners is trading above baseline with $12,451 of available capital and $3,201 of cushion, lifted mainly by a $4,200 paycheck.";
    expect(bodyOnlyReferencesKnownAmounts(input, { body, referencedDriverIds: ["d1"] })).toBe(
      true,
    );
  });

  it("fails when the body states a dollar figure absent from the input", () => {
    const body = "Blue Reef Partners is trading above baseline with $9,000 of available capital.";
    expect(bodyOnlyReferencesKnownAmounts(input, { body, referencedDriverIds: [] })).toBe(false);
  });

  it("passes a rounding-consistent figure (input cents round to whole dollars)", () => {
    const centsInput = narrationInputSchema.parse({ ...validInput, availableCapital: 8000.49 });
    const body = "Available capital stands at $8,000 this period.";
    expect(bodyOnlyReferencesKnownAmounts(centsInput, { body, referencedDriverIds: [] })).toBe(
      true,
    );
  });

  it("passes a body with no dollar figures at all", () => {
    const body = "Blue Reef Partners is trading above its baseline and momentum is improving.";
    expect(bodyOnlyReferencesKnownAmounts(input, { body, referencedDriverIds: [] })).toBe(true);
  });

  it("passes a body describing a driver's absolute-value impact", () => {
    const body = "Progress was tempered by a $500 investment contribution mid-period.";
    expect(bodyOnlyReferencesKnownAmounts(input, { body, referencedDriverIds: ["d2"] })).toBe(
      true,
    );
  });

  it("passes a body that sums two same-direction driver impacts (observed live: a real model summarized two paychecks as a total rather than citing each)", () => {
    const twoPaychecks = narrationInputSchema.parse({
      ...validInput,
      drivers: [
        { id: "d1", kind: "paycheck", date: "2026-07-01", impact: 3450, buildsEquity: false },
        { id: "d2", kind: "paycheck", date: "2026-07-15", impact: 3450, buildsEquity: false },
      ],
    });
    const body = "Two paychecks totaling $6,900 drove the period's gains.";
    expect(
      bodyOnlyReferencesKnownAmounts(twoPaychecks, { body, referencedDriverIds: ["d1", "d2"] }),
    ).toBe(true);
  });

  it("still rejects a genuinely fabricated aggregate that doesn't match total inflow, total outflow, or net impact", () => {
    const body = "The household saw a combined swing of $9,999 across all drivers.";
    expect(bodyOnlyReferencesKnownAmounts(input, { body, referencedDriverIds: [] })).toBe(false);
  });
});

describe("bodyDoesNotMislabelScore", () => {
  it("passes a body that never mentions credit at all", () => {
    const body =
      "Blue Reef Partners is trading above its baseline with a PFI Score of 695 in the Strong band.";
    expect(bodyDoesNotMislabelScore({ body, referencedDriverIds: [] })).toBe(true);
  });

  it("rejects a body that calls the PFI Score a credit score (observed live: a real model did exactly this)", () => {
    const body = "The household's credit score of 695 reflects strong financial health.";
    expect(bodyDoesNotMislabelScore({ body, referencedDriverIds: [] })).toBe(false);
  });

  it("rejects case-insensitively", () => {
    const body = "This Credit Score indicates the household is doing well.";
    expect(bodyDoesNotMislabelScore({ body, referencedDriverIds: [] })).toBe(false);
  });

  it("rejects the adjacent misnomers 'credit rating' and 'FICO'", () => {
    expect(
      bodyDoesNotMislabelScore({
        body: "The household's credit rating stands at 695.",
        referencedDriverIds: [],
      }),
    ).toBe(false);
    expect(
      bodyDoesNotMislabelScore({
        body: "The household's FICO score stands at 695.",
        referencedDriverIds: [],
      }),
    ).toBe(false);
  });

  it("passes a body mentioning debt or credit cards without calling the score a credit score", () => {
    const body = "A credit card payment of $640 was offset by two paychecks this period.";
    expect(bodyDoesNotMislabelScore({ body, referencedDriverIds: [] })).toBe(true);
  });
});
