import { describe, expect, it } from "vitest";
import {
  BRIEF_SURFACE,
  briefInputSchema,
  briefOutputSchema,
  referencesOnlyKnownDrivers,
  bodyOnlyReferencesKnownAmounts,
  bodyDoesNotMislabelScore,
} from "./schemas";

const validInput = {
  surface: BRIEF_SURFACE,
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

describe("briefInputSchema", () => {
  it("accepts a valid input", () => {
    expect(briefInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("rejects unknown fields (raw-data smuggling)", () => {
    expect(
      briefInputSchema.safeParse({ ...validInput, transactions: [] }).success,
    ).toBe(false);
    expect(
      briefInputSchema.safeParse({
        ...validInput,
        drivers: [{ ...validInput.drivers[0], label: "ACME PAYROLL" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a driver kind outside the event-type enum", () => {
    expect(
      briefInputSchema.safeParse({
        ...validInput,
        drivers: [{ ...validInput.drivers[0], kind: "merchant_purchase" }],
      }).success,
    ).toBe(false);
  });

  it("allows a null score", () => {
    expect(briefInputSchema.safeParse({ ...validInput, score: null }).success).toBe(true);
  });
});

describe("briefOutputSchema", () => {
  it("accepts a valid output", () => {
    const out = {
      body: "Blue Reef Partners is trading above its baseline with $12,451 of available capital, lifted mainly by a $4,200 paycheck on Jul 15.",
      referencedDriverIds: ["d1"],
    };
    expect(briefOutputSchema.parse(out)).toEqual(out);
  });

  it("rejects extra fields and out-of-bounds body length", () => {
    expect(
      briefOutputSchema.safeParse({ body: "short", referencedDriverIds: [] }).success,
    ).toBe(false);
    expect(
      briefOutputSchema.safeParse({
        body: "x".repeat(50),
        referencedDriverIds: [],
        advice: "buy stocks",
      }).success,
    ).toBe(false);
    expect(
      briefOutputSchema.safeParse({ body: "x".repeat(701), referencedDriverIds: [] }).success,
    ).toBe(false);
  });
});

describe("referencesOnlyKnownDrivers", () => {
  const input = briefInputSchema.parse(validInput);
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
  const input = briefInputSchema.parse(validInput);

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
    const centsInput = briefInputSchema.parse({ ...validInput, availableCapital: 8000.49 });
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
    const twoPaychecks = briefInputSchema.parse({
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

import {
  driverExplanationsInputSchema,
  driverExplanationsOutputSchema,
  explanationsCoverExactlyKnownDrivers,
  explanationAmountsAreKnown,
  explanationsDoNotMislabelScore,
  narrationInputSchema,
  type DriverExplanationsInput,
  type DriverExplanationsOutput,
} from "./schemas";

const driverInput: DriverExplanationsInput = {
  surface: "driver_explanations",
  companyName: "Test Co",
  periodDays: 30,
  totalInflow: 6900,
  totalOutflow: 2200,
  netImpact: 4700,
  drivers: [
    { id: "d1", kind: "paycheck", date: "2026-07-03", impact: 3450, buildsEquity: false },
    { id: "d2", kind: "mortgage_payment", date: "2026-07-01", impact: -2200, buildsEquity: false },
  ],
};

const goodOutput: DriverExplanationsOutput = {
  explanations: [
    { driverId: "d1", body: "A paycheck added $3,450 to available capital this period." },
    { driverId: "d2", body: "The mortgage payment reduced available capital by $2,200." },
  ],
};

describe("driverExplanationsInputSchema", () => {
  it("accepts a valid input", () => {
    expect(driverExplanationsInputSchema.parse(driverInput)).toEqual(driverInput);
  });
  it("rejects an empty driver array (no drivers means no call)", () => {
    expect(
      driverExplanationsInputSchema.safeParse({ ...driverInput, drivers: [] }).success,
    ).toBe(false);
  });
  it("rejects unknown fields (strict boundary)", () => {
    expect(
      driverExplanationsInputSchema.safeParse({ ...driverInput, label: "smuggled" }).success,
    ).toBe(false);
  });
  it("round-trips through the discriminated union", () => {
    expect(narrationInputSchema.parse(driverInput)).toEqual(driverInput);
  });
});

describe("driverExplanationsOutputSchema", () => {
  it("accepts a valid output", () => {
    expect(driverExplanationsOutputSchema.parse(goodOutput)).toEqual(goodOutput);
  });
  it("rejects a body under 20 chars", () => {
    const short = { explanations: [{ driverId: "d1", body: "too short" }] };
    expect(driverExplanationsOutputSchema.safeParse(short).success).toBe(false);
  });
  it("rejects a body over 280 chars", () => {
    const long = { explanations: [{ driverId: "d1", body: "x".repeat(281) }] };
    expect(driverExplanationsOutputSchema.safeParse(long).success).toBe(false);
  });
});

describe("explanationsCoverExactlyKnownDrivers", () => {
  it("passes when ids match exactly", () => {
    expect(explanationsCoverExactlyKnownDrivers(driverInput, goodOutput)).toBe(true);
  });
  it("fails when a driver is missing (whole set falls back)", () => {
    const missing = { explanations: [goodOutput.explanations[0]] };
    expect(explanationsCoverExactlyKnownDrivers(driverInput, missing)).toBe(false);
  });
  it("fails on an invented driver id", () => {
    const invented = {
      explanations: [...goodOutput.explanations, { driverId: "d9", body: "x".repeat(30) }],
    };
    expect(explanationsCoverExactlyKnownDrivers(driverInput, invented)).toBe(false);
  });
  it("fails on duplicate ids", () => {
    const dupes = {
      explanations: [goodOutput.explanations[0], { ...goodOutput.explanations[0] }],
    };
    expect(explanationsCoverExactlyKnownDrivers(driverInput, dupes)).toBe(false);
  });
});

describe("explanationAmountsAreKnown", () => {
  it("passes when every figure is a driver magnitude or aggregate", () => {
    expect(explanationAmountsAreKnown(driverInput, goodOutput)).toBe(true);
  });
  it("accepts the aggregate figures (inflow/outflow/net)", () => {
    const agg = {
      explanations: [
        { driverId: "d1", body: "Inflows totaling $6,900 outweighed $2,200 of outflows." },
        { driverId: "d2", body: "Net driver movement this period came to $4,700." },
      ],
    };
    expect(explanationAmountsAreKnown(driverInput, agg)).toBe(true);
  });
  it("fails on a hallucinated figure", () => {
    const bad = {
      explanations: [
        { driverId: "d1", body: "A paycheck added $9,999 to available capital." },
        goodOutput.explanations[1],
      ],
    };
    expect(explanationAmountsAreKnown(driverInput, bad)).toBe(false);
  });
});

describe("explanationsDoNotMislabelScore", () => {
  it("fails when any body says credit score", () => {
    const bad = {
      explanations: [
        { driverId: "d1", body: "This paycheck should help your credit score improve." },
        goodOutput.explanations[1],
      ],
    };
    expect(explanationsDoNotMislabelScore(bad)).toBe(false);
  });
});
