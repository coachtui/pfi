import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { CATEGORIES } from "@/lib/config/categories";
import { env } from "@/lib/config/env";
import type { CsvMappingSuggestion } from "./types";

const accountTypeSchema = z.enum([
  "checking",
  "savings",
  "money_market",
  "credit_card",
  "mortgage",
  "auto_loan",
  "student_loan",
  "personal_loan",
  "brokerage",
  "retirement",
  "property",
  "other_asset",
  "other_liability",
]);

const profileSchema = z
  .object({
    index: z.number().int().min(0).max(49),
    header: z.string().max(100),
    nonEmptyRatio: z.number().min(0).max(1),
    dateLikeRatio: z.number().min(0).max(1),
    amountLikeRatio: z.number().min(0).max(1),
    distinctRatio: z.number().min(0).max(1),
    averageLength: z.number().min(0).max(10_000),
  })
  .strict();

export const csvMappingAiInputSchema = z
  .object({
    accountType: accountTypeSchema,
    columns: z.array(profileSchema).min(1).max(50),
    categoryValues: z.array(z.string().min(1).max(100)).max(50),
  })
  .strict();

export type CsvMappingAiInput = z.infer<typeof csvMappingAiInputSchema>;

const nullableColumn = z.number().int().min(0).max(49).nullable();
const outputSchema = z
  .object({
    columns: z
      .object({
        date: nullableColumn,
        description: nullableColumn,
        amount: nullableColumn,
        debit: nullableColumn,
        credit: nullableColumn,
        category: nullableColumn,
      })
      .strict(),
    signConvention: z.enum(["positive_inflow", "positive_outflow"]).nullable(),
    categories: z
      .array(
        z
          .object({
            source: z.string().min(1).max(100),
            category: z.enum(CATEGORIES),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export interface CsvMappingAiOptions {
  model?: LanguageModel;
  timeoutMs?: number;
}

const SYSTEM_PROMPT = `You map bank CSV schemas into PFI's transaction import fields.
The input contains no transaction values. Use header names and structural ratios only.
Return null for any column role you cannot identify confidently.
Use either one signed amount column, or separate debit and credit columns, never both.
Category suggestions classify bank-provided category labels only.
Never infer, reconstruct, or request transaction descriptions, dates, balances, account numbers, or monetary values.`;

/** Optional, privacy-scoped fallback. Every suggestion is validated again by
 * deterministic client logic and shown to the user before import. */
export async function generateCsvMappingSuggestion(
  input: CsvMappingAiInput,
  opts: CsvMappingAiOptions = {},
): Promise<CsvMappingSuggestion | null> {
  const parsed = csvMappingAiInputSchema.safeParse(input);
  if (!parsed.success) return null;
  const model = opts.model ?? (env.AI_GATEWAY_API_KEY ? env.PFI_AI_MODEL : undefined);
  if (!model) return null;

  try {
    const { object } = await generateObject({
      model,
      schema: outputSchema,
      system: SYSTEM_PROMPT,
      prompt: JSON.stringify(parsed.data),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      temperature: 0,
    });
    const validIndexes = new Set(parsed.data.columns.map((column) => column.index));
    const cleanColumn = (index: number | null) =>
      index !== null && validIndexes.has(index) ? index : null;
    const knownCategories = new Map(
      parsed.data.categoryValues.map((value) => [value.toLowerCase(), value]),
    );
    const categoryValues: CsvMappingSuggestion["categoryValues"] = {};
    for (const item of object.categories) {
      const source = knownCategories.get(item.source.toLowerCase());
      if (source) categoryValues[source.toLowerCase()] = item.category;
    }
    const columns = {
      date: cleanColumn(object.columns.date),
      description: cleanColumn(object.columns.description),
      amount: cleanColumn(object.columns.amount),
      debit: cleanColumn(object.columns.debit),
      credit: cleanColumn(object.columns.credit),
      category: cleanColumn(object.columns.category),
    };
    if (columns.amount !== null) {
      columns.debit = null;
      columns.credit = null;
    }
    return { columns, signConvention: object.signConvention, categoryValues };
  } catch {
    return null;
  }
}
