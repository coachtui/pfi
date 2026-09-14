import { z } from "zod";

/** Inputs for the Plaid server actions (src/app/actions/plaid.ts). */
export const exchangePublicTokenSchema = z.object({
  publicToken: z.string().min(1).max(512),
  institutionId: z.string().min(1).max(64).nullable(),
  institutionName: z.string().min(1).max(120).nullable(),
});
export type ExchangePublicTokenInput = z.infer<typeof exchangePublicTokenSchema>;

export const itemIdSchema = z.uuid();
