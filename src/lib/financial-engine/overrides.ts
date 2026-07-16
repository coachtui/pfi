import type { ISODate } from "./types";

/**
 * User corrections to a transaction. Stored in the `user_override` jsonb
 * column (migration 0002 freezes every source column except `user_override`
 * and `notes`). Overrides are a display/report-layer correction: snapshot
 * building intentionally reads source columns only, so an override can never
 * change balances or the index (v1 — see KNOWN_LIMITATIONS for the
 * income-recategorization consequence).
 */
export interface TransactionOverride {
  category?: string;
  description?: string;
}

/** Defensive parse of the raw jsonb — only known string keys survive. */
export function parseOverride(raw: unknown): TransactionOverride | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: TransactionOverride = {};
  if (typeof o.category === "string") out.category = o.category;
  if (typeof o.description === "string") out.description = o.description;
  return Object.keys(out).length > 0 ? out : null;
}

export interface CorrectableTransaction {
  id: string;
  accountId: string;
  postedDate: ISODate;
  amount: number;
  direction: "inflow" | "outflow";
  description: string;
  category: string | null;
  essential: boolean | null;
  isTransfer: boolean;
  transferPairId: string | null;
  userOverride: TransactionOverride | null;
}

export interface EffectiveTransaction extends Omit<CorrectableTransaction, "userOverride"> {
  corrected: boolean;
  /** Source values that were overridden, for "original" display. Null when uncorrected. */
  original: { category: string | null; description: string } | null;
}

export function applyOverride(t: CorrectableTransaction): EffectiveTransaction {
  const { userOverride, ...source } = t;
  if (!userOverride) return { ...source, corrected: false, original: null };
  return {
    ...source,
    category: userOverride.category ?? source.category,
    description: userOverride.description ?? source.description,
    corrected: true,
    original: { category: source.category, description: source.description },
  };
}
