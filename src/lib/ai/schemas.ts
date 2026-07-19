import { z } from "zod";

/**
 * The AI data boundary. NarrationInput is the ONLY thing the model ever
 * sees about a user: derived metrics with dollar values, never raw
 * transaction rows, merchant names, account identifiers, or event labels
 * (labels may embed user-entered text — drivers carry the type enum only).
 * `.strict()` everywhere makes smuggling extra fields a runtime error.
 * See docs/AI_RECOMMENDATION_POLICY.md.
 */

export const NARRATION_SURFACE = "performance_brief" as const;

/** Mirrors FinancialEventType in src/lib/financial-engine/types.ts. */
const driverKindSchema = z.enum([
  "paycheck",
  "bonus",
  "mortgage_payment",
  "large_purchase",
  "insurance_payment",
  "investment_contribution",
  "debt_payment",
  "debt_payoff",
  "tax_payment",
  "unexpected_expense",
]);

const narrationDriverSchema = z
  .object({
    id: z.string().regex(/^d\d+$/),
    kind: driverKindSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Signed dollar impact on available position (+ improves, − reduces). */
    impact: z.number(),
    buildsEquity: z.boolean(),
  })
  .strict();

export const narrationInputSchema = z
  .object({
    surface: z.literal(NARRATION_SURFACE),
    companyName: z.string().min(1),
    periodDays: z.number().int().positive(),
    availableCapital: z.number(),
    cushion: z.number(),
    vsBaseline: z.enum(["above", "below", "at", "unknown"]),
    vsWaterline: z.enum(["above", "below", "at"]),
    momentum: z
      .object({
        direction: z.enum(["improving", "stable", "declining"]),
        delta: z.number(),
        windowDays: z.number().int().positive(),
      })
      .strict(),
    drivers: z.array(narrationDriverSchema).max(4),
    score: z
      .object({
        overall: z.number().nullable(),
        band: z.string().nullable(),
        momentum: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const narrationOutputSchema = z
  .object({
    /** The narrated brief. Bounds keep it a paragraph, not an essay. */
    body: z.string().min(40).max(700),
    /** Every driver the narration mentions, by input id — traceability. */
    referencedDriverIds: z.array(z.string()),
  })
  .strict();

export type NarrationInput = z.infer<typeof narrationInputSchema>;
export type NarrationOutput = z.infer<typeof narrationOutputSchema>;

/** Policy check: AI may not invent a driver (AI_RECOMMENDATION_POLICY.md). */
export function referencesOnlyKnownDrivers(
  input: NarrationInput,
  output: NarrationOutput,
): boolean {
  const known = new Set(input.drivers.map((d) => d.id));
  return output.referencedDriverIds.every((id) => known.has(id));
}

/**
 * Policy check: narration prose may not state a dollar figure absent from
 * its input (AI_RECOMMENDATION_POLICY.md — "deterministic code calculates,
 * AI only narrates"). Every "$"-prefixed number in `output.body` must round
 * to a known amount: available capital, cushion, a driver's magnitude
 * (narration may describe a driver's size without its sign), or one of the
 * natural driver aggregates a narrator reasonably states in prose — total
 * inflows, total outflows, or the net of all driver impacts (observed live:
 * a real model summarized two paychecks as "totaling $X" rather than citing
 * each individually — a correct sum, not a hallucination, so the aggregate
 * itself must be a known value too). Rounds to the nearest whole dollar on
 * both sides — narration prose doesn't state cents in practice — to avoid
 * brittle float-equality comparisons. A body with no dollar figures at all
 * passes trivially: this check only fires when the AI actually asserts a
 * number.
 */
export function bodyOnlyReferencesKnownAmounts(
  input: NarrationInput,
  output: NarrationOutput,
): boolean {
  try {
    const matches = output.body.match(/\$[\d,]+(?:\.\d{2})?/g);
    if (!matches) return true;

    const round = (n: number) => Math.round(n);
    const totalInflow = input.drivers
      .filter((d) => d.impact > 0)
      .reduce((sum, d) => sum + d.impact, 0);
    const totalOutflow = input.drivers
      .filter((d) => d.impact < 0)
      .reduce((sum, d) => sum + Math.abs(d.impact), 0);
    const netImpact = input.drivers.reduce((sum, d) => sum + d.impact, 0);

    const known = new Set<number>([
      round(input.availableCapital),
      round(input.cushion),
      ...input.drivers.map((d) => round(Math.abs(d.impact))),
      round(totalInflow),
      round(totalOutflow),
      round(Math.abs(netImpact)),
    ]);

    return matches.every((match) => {
      const value = Number.parseFloat(match.replace(/[$,]/g, ""));
      if (Number.isNaN(value)) return false;
      return known.has(round(value));
    });
  } catch {
    return false;
  }
}
