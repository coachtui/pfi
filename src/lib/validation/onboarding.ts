import { z } from "zod";
import { AGE_COHORTS, COL_CATEGORIES, HOUSEHOLD_TYPES, INCOME_BANDS, OBJECTIVES } from "@/lib/config/cohorts";

export const onboardingSchema = z.object({
  companyName: z.string().trim().min(2).max(40),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "2–5 letters"),
  username: z.string().trim().regex(/^[a-zA-Z0-9_]{3,20}$/, "3–20 letters, numbers, underscores"),
  ageCohort: z.enum(AGE_COHORTS),
  incomeBand: z.enum(INCOME_BANDS),
  householdType: z.enum(HOUSEHOLD_TYPES),
  colCohort: z.enum(COL_CATEGORIES),
  objective: z.enum(OBJECTIVES.map((o) => o.value) as [string, ...string[]]),
  loadDemo: z.boolean(),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;
