import { z } from "zod";
import { AGE_COHORTS, COL_CATEGORIES, HOUSEHOLD_TYPES, INCOME_BANDS, OBJECTIVES } from "@/lib/config/cohorts";
import { companyNameField, tickerField, usernameField } from "@/lib/validation/company-profile";

export const onboardingSchema = z.object({
  companyName: companyNameField,
  ticker: tickerField,
  username: usernameField,
  ageCohort: z.enum(AGE_COHORTS),
  incomeBand: z.enum(INCOME_BANDS),
  householdType: z.enum(HOUSEHOLD_TYPES),
  colCohort: z.enum(COL_CATEGORIES),
  objective: z.enum(OBJECTIVES.map((o) => o.value) as [string, ...string[]]),
  loadDemo: z.boolean(),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;
