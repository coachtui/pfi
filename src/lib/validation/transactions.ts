import { z } from "zod";
import { CATEGORIES, type Category } from "@/lib/config/categories";
import type { AccountType } from "@/lib/financial-engine";

/** Runtime mirror of the engine's AccountType (and the DB check constraint). */
export const ACCOUNT_TYPES = [
  "checking", "savings", "money_market", "credit_card", "mortgage",
  "auto_loan", "student_loan", "personal_loan", "brokerage", "retirement",
  "property", "other_asset", "other_liability",
] as const satisfies readonly AccountType[];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking", savings: "Savings", money_market: "Money market",
  credit_card: "Credit card", mortgage: "Mortgage", auto_loan: "Auto loan",
  student_loan: "Student loan", personal_loan: "Personal loan",
  brokerage: "Brokerage", retirement: "Retirement", property: "Property",
  other_asset: "Other asset", other_liability: "Other liability",
};

/** Shared result shape for all mutation server actions. `error: ""` = success;
 * `warning` = saved, but the snapshot rebuild failed (retryable). */
export interface MutationResult {
  error: string;
  warning?: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const notFuture = (d: string) => d <= new Date().toISOString().slice(0, 10);

export const createTransactionSchema = z.object({
  accountId: z.uuid(),
  postedDate: isoDate.refine(notFuture, "Date can't be in the future"),
  amount: z.number().positive("Amount must be positive").max(10_000_000),
  direction: z.enum(["inflow", "outflow"]),
  description: z.string().trim().min(1, "Description is required").max(120),
  category: z.enum(CATEGORIES).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type TransactionFormValues = z.infer<typeof createTransactionSchema>;

export const overrideTransactionSchema = z
  .object({
    id: z.uuid(),
    category: z.enum(CATEGORIES).nullable().optional(),
    description: z.string().trim().min(1).max(120).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (v) => v.category !== undefined || v.description !== undefined || v.notes !== undefined,
    "Nothing to update",
  );
export type OverrideFormValues = z.infer<typeof overrideTransactionSchema>;

export const accountSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(60).optional(),
  /** Balance as of today. Enter liabilities as positive amounts. */
  currentBalance: z.number().min(0).max(100_000_000),
  creditLimit: z.number().min(0).max(100_000_000).optional(),
  /** Percent, e.g. 6.25 */
  interestRate: z.number().min(0).max(99.9999).optional(),
});
export type AccountFormValues = z.infer<typeof accountSchema>;

export const updateAccountSchema = accountSchema.extend({ id: z.uuid() });

export interface TransactionFilters {
  account?: string;
  category?: Category;
  direction?: "inflow" | "outflow";
  from?: string;
  to?: string;
}

export function parseTransactionFilters(
  sp: Record<string, string | string[] | undefined>,
): TransactionFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const cat = s("category");
  const dir = s("direction");
  return {
    account: s("account"),
    category: (CATEGORIES as readonly string[]).includes(cat ?? "") ? (cat as Category) : undefined,
    direction: dir === "inflow" || dir === "outflow" ? dir : undefined,
    from: iso(s("from")),
    to: iso(s("to")),
  };
}
