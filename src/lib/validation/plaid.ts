import { z } from "zod";

/** Inputs for the Plaid server actions (src/app/actions/plaid.ts). */
export const exchangePublicTokenSchema = z.object({
  publicToken: z.string().min(1).max(512),
  institutionId: z.string().min(1).max(64).nullable(),
  // Link metadata may hand back an empty name; never fail the exchange over it (the Item already exists at Plaid).
  institutionName: z.string().max(120).nullable().transform((s) => (s && s.trim() ? s.trim() : null)),
});
export type ExchangePublicTokenInput = z.infer<typeof exchangePublicTokenSchema>;

export const itemIdSchema = z.uuid();
