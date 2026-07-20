import { z } from "zod";

/**
 * The AI data boundary. BriefInput is the ONLY thing the model ever
 * sees about a user: derived metrics with dollar values, never raw
 * transaction rows, merchant names, account identifiers, or event labels
 * (labels may embed user-entered text — drivers carry the type enum only).
 * `.strict()` everywhere makes smuggling extra fields a runtime error.
 * See docs/AI_RECOMMENDATION_POLICY.md.
 */

export const BRIEF_SURFACE = "performance_brief" as const;
export const DRIVER_EXPLANATIONS_SURFACE = "driver_explanations" as const;
export type NarrationSurface = typeof BRIEF_SURFACE | typeof DRIVER_EXPLANATIONS_SURFACE;

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

export const narrationDriverSchema = z
  .object({
    id: z.string().regex(/^d\d+$/),
    kind: driverKindSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Signed dollar impact on available position (+ improves, − reduces). */
    impact: z.number(),
    buildsEquity: z.boolean(),
  })
  .strict();

export const briefInputSchema = z
  .object({
    surface: z.literal(BRIEF_SURFACE),
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

export const briefOutputSchema = z
  .object({
    /** The narrated brief. Bounds keep it a paragraph, not an essay. */
    body: z.string().min(40).max(700),
    /** Every driver the narration mentions, by input id — traceability. */
    referencedDriverIds: z.array(z.string()),
  })
  .strict();

export type BriefInput = z.infer<typeof briefInputSchema>;
export type BriefOutput = z.infer<typeof briefOutputSchema>;

export const driverExplanationsInputSchema = z
  .object({
    surface: z.literal(DRIVER_EXPLANATIONS_SURFACE),
    companyName: z.string().min(1),
    periodDays: z.number().int().positive(),
    /** Sum of positive driver impacts (dollars). */
    totalInflow: z.number().min(0),
    /** Sum of negative driver impact magnitudes (dollars). */
    totalOutflow: z.number().min(0),
    /** Signed net of all driver impacts. */
    netImpact: z.number(),
    drivers: z.array(narrationDriverSchema).min(1).max(4),
  })
  .strict();

/** All AI inputs, discriminated on surface — the one type hash/narrator accept. */
export const narrationInputSchema = z.discriminatedUnion("surface", [
  briefInputSchema,
  driverExplanationsInputSchema,
]);

export type DriverExplanationsInput = z.infer<typeof driverExplanationsInputSchema>;
export type NarrationInput = z.infer<typeof narrationInputSchema>;

export const driverExplanationsOutputSchema = z
  .object({
    /** One short explanation per input driver, keyed by its internal id. */
    explanations: z
      .array(
        z
          .object({
            driverId: z.string().regex(/^d\d+$/),
            body: z.string().min(20).max(280),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

export type DriverExplanationsOutput = z.infer<typeof driverExplanationsOutputSchema>;

/** Policy check: AI may not invent a driver (AI_RECOMMENDATION_POLICY.md). */
export function referencesOnlyKnownDrivers(
  input: BriefInput,
  output: BriefOutput,
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
export function textOnlyReferencesKnownAmounts(
  text: string,
  known: ReadonlySet<number>,
): boolean {
  try {
    const matches = text.match(/\$[\d,]+(?:\.\d{2})?/g);
    if (!matches) return true;
    return matches.every((match) => {
      const value = Number.parseFloat(match.replace(/[$,]/g, ""));
      if (Number.isNaN(value)) return false;
      return known.has(Math.round(value));
    });
  } catch {
    return false;
  }
}

/** Known-amount set for a driver array: magnitudes plus natural aggregates. */
export function driverAmountSet(drivers: ReadonlyArray<{ impact: number }>): Set<number> {
  const round = (n: number) => Math.round(n);
  const totalInflow = drivers.filter((d) => d.impact > 0).reduce((s, d) => s + d.impact, 0);
  const totalOutflow = drivers.filter((d) => d.impact < 0).reduce((s, d) => s + Math.abs(d.impact), 0);
  const netImpact = drivers.reduce((s, d) => s + d.impact, 0);
  return new Set<number>([
    ...drivers.map((d) => round(Math.abs(d.impact))),
    round(totalInflow),
    round(totalOutflow),
    round(Math.abs(netImpact)),
  ]);
}

export function bodyOnlyReferencesKnownAmounts(
  input: BriefInput,
  output: BriefOutput,
): boolean {
  const known = driverAmountSet(input.drivers);
  known.add(Math.round(input.availableCapital));
  known.add(Math.round(input.cushion));
  return textOnlyReferencesKnownAmounts(output.body, known);
}

/** Phrases that mislabel the PFI Score as a credit product, case-insensitive. */
const SCORE_MISLABEL_PATTERNS = [/credit\s+score/i, /credit\s+rating/i, /fico/i];

/**
 * Policy check: narration must never describe the PFI Score as a credit
 * score, credit rating, or FICO score — CLAUDE.md is explicit that "the
 * health score (0–900, Phase 2) is not a credit score and must never be
 * described as one." A prompt instruction alone isn't reliable enough for a
 * rule this load-bearing (observed live: a real model called the PFI Score
 * a "credit score" despite no such prompting), so this is enforced as a
 * deterministic runtime guard, the same defense-in-depth pattern already
 * used for hallucinated dollar figures and invented driver references. Only
 * blocks the specific mislabeling phrases — ordinary mentions of "credit
 * card" or "debt" pass through untouched.
 */
export function textDoesNotMislabelScore(text: string): boolean {
  return !SCORE_MISLABEL_PATTERNS.some((pattern) => pattern.test(text));
}

export function bodyDoesNotMislabelScore(output: BriefOutput): boolean {
  return textDoesNotMislabelScore(output.body);
}

/**
 * Policy check: exactly one explanation per known driver — none invented,
 * none missing, no duplicates. A missing driver invalidates the whole set
 * (the UI would otherwise show a mixed AI/deterministic accordion for one
 * generation, which reads as inconsistency, not graceful degradation).
 */
export function explanationsCoverExactlyKnownDrivers(
  input: DriverExplanationsInput,
  output: DriverExplanationsOutput,
): boolean {
  const known = input.drivers.map((d) => d.id).sort();
  const got = output.explanations.map((e) => e.driverId).sort();
  return known.length === got.length && known.every((id, i) => id === got[i]);
}

/** Policy check: every dollar figure in every body is a known amount. */
export function explanationAmountsAreKnown(
  input: DriverExplanationsInput,
  output: DriverExplanationsOutput,
): boolean {
  const known = driverAmountSet(input.drivers);
  known.add(Math.round(input.totalInflow));
  known.add(Math.round(input.totalOutflow));
  known.add(Math.round(Math.abs(input.netImpact)));
  return output.explanations.every((e) => textOnlyReferencesKnownAmounts(e.body, known));
}

/** Policy check: no body mislabels the PFI Score (defense-in-depth). */
export function explanationsDoNotMislabelScore(output: DriverExplanationsOutput): boolean {
  return output.explanations.every((e) => textDoesNotMislabelScore(e.body));
}
