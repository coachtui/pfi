import { z } from "zod";
import { CATEGORIES } from "@/lib/config/categories";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const notFuture = (d: string) => d <= new Date().toISOString().slice(0, 10);

const importRowSchema = z.object({
  line: z.number().int().min(2),
  postedDate: isoDate.refine(notFuture, "Date can't be in the future"),
  amount: z
    .number()
    .positive()
    .max(10_000_000)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Amounts use at most 2 decimals"),
  direction: z.enum(["inflow", "outflow"]),
  description: z.string().trim().min(1).max(200),
  category: z.enum(CATEGORIES),
});

export const importTransactionsSchema = z
  .object({
    accountId: z.uuid(),
    rows: z.array(importRowSchema).min(1, "Nothing to import").max(10_000, "Too many rows (max 10,000)"),
    transferPairs: z.array(z.object({ line: z.number().int().min(2), existingId: z.uuid() })).max(2_000),
    endingBalance: z
      .number()
      .min(-10_000_000)
      .max(10_000_000)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Amounts use at most 2 decimals")
      .optional(),
    anchorDate: isoDate.refine(notFuture, "Date can't be in the future").optional(),
  })
  .refine((v) => (v.endingBalance === undefined) === (v.anchorDate === undefined), {
    message: "Ending balance and its date go together",
  });
export type ImportTransactionsInput = z.infer<typeof importTransactionsSchema>;

const confidence = z.enum(["high", "medium", "low"]);

export const confirmPdfImportSchema = z.object({
  importId: z.uuid(),
  accountId: z.uuid(),
  metadata: z.object({
    institution: z.string().trim().max(80).nullable(),
    accountName: z.string().trim().max(80).nullable(),
    accountType: z.enum(["checking", "savings", "credit_card"]).nullable(),
    maskedAccountNumber: z.string().trim().max(20).nullable(),
    statementStartDate: isoDate.nullable(),
    statementEndDate: isoDate.nullable(),
    beginningBalance: z.number().min(-10_000_000).max(10_000_000).nullable(),
    endingBalance: z.number().min(-10_000_000).max(10_000_000).nullable(),
    availableBalance: z.number().min(-10_000_000).max(10_000_000).nullable(),
    creditLimit: z.number().min(0).max(100_000_000).nullable(),
    minimumPayment: z.number().min(0).max(10_000_000).nullable(),
    paymentDueDate: isoDate.nullable(),
  }),
  rows: z.array(z.object({
    stagedId: z.uuid(),
    line: z.number().int().min(1),
    postedDate: isoDate.refine(notFuture, "Date can't be in the future"),
    transactionDate: isoDate.nullable(),
    amount: z
      .number()
      .positive()
      .max(10_000_000)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Amounts use at most 2 decimals"),
    direction: z.enum(["inflow", "outflow"]),
    description: z.string().trim().min(1).max(200),
    category: z.enum(CATEGORIES),
    referenceNumber: z.string().trim().max(80).nullable(),
    sourcePage: z.number().int().positive().nullable(),
    confidence,
    excluded: z.boolean(),
    duplicateDecision: z.enum(["import", "exclude"]).nullable(),
  })).min(1).max(10_000),
});
export type ConfirmPdfImportInput = z.infer<typeof confirmPdfImportSchema>;

/** MutationResult + server-confirmed batch facts for the summary screen. */
export interface ImportResult {
  error: string;
  warning?: string;
  batchId?: string;
  imported?: number;
  skippedDuplicates?: number;
  anchorDate?: string;
  anchoredBalance?: number;
  discrepancy?: number | null;
}
