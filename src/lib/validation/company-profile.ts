import { z } from "zod";

// Shared identity fields — the single source of truth for company name,
// ticker, and username validation, consumed by both onboarding and the
// profile edit sheet so the two can never drift.
export const companyNameField = z.string().trim().min(2).max(40);
export const tickerField = z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "2–5 letters");
export const usernameField = z.string().trim().regex(/^[a-zA-Z0-9_]{3,20}$/, "3–20 letters, numbers, underscores");

// Emblem: a `preset:<id>` tag or null (default). The `upload:*` namespace is
// reserved for the deferred custom-upload slice and is intentionally rejected
// here so this slice can never persist one.
export const logoPathField = z.string().regex(/^preset:[a-z0-9-]+$/, "Invalid emblem").nullable();

export const companyProfileSchema = z.object({
  companyName: companyNameField,
  ticker: tickerField,
  username: usernameField,
  logoPath: logoPathField,
});

export type CompanyProfileValues = z.infer<typeof companyProfileSchema>;
