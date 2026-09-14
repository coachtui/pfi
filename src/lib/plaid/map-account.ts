/**
 * Plaid account → PFI account mapping (spec §8). Pure and framework-free.
 * Plaid `type`/`subtype` values are lower-case strings from Plaid's published
 * account-type list; anything unrecognized falls back conservatively per type.
 */
import type { AccountType } from "@/lib/financial-engine";
import type { PlaidAccountShape } from "./types";

const DEPOSITORY: Record<string, AccountType> = {
  checking: "checking",
  "cash management": "checking",
  paypal: "checking",
  prepaid: "checking",
  ebt: "checking",
  savings: "savings",
  cd: "savings",
  hsa: "savings",
  "money market": "money_market",
};

const LOAN: Record<string, AccountType> = {
  mortgage: "mortgage",
  "home equity": "mortgage",
  auto: "auto_loan",
  student: "student_loan",
};

const RETIREMENT_SUBTYPES: ReadonlySet<string> = new Set([
  "401a", "401k", "403b", "457b", "ira", "roth", "roth 401k", "sep ira", "simple ira", "sarsep",
  "pension", "profit sharing plan", "retirement", "tsp", "keogh", "lira", "lrif", "lrsp", "prif",
  "rlif", "rrif", "rrsp", "sipp", "stock plan", "gic", "hsa",
]);

/** Plaid `type`/`subtype` → PFI `AccountType`. */
export function mapAccountType(type: string, subtype: string | null): AccountType {
  const t = type.toLowerCase();
  const s = (subtype ?? "").toLowerCase();
  switch (t) {
    case "depository":
      return DEPOSITORY[s] ?? "checking";
    case "credit":
      return "credit_card";
    case "loan":
      return LOAN[s] ?? "personal_loan";
    case "investment":
    case "brokerage":
      return RETIREMENT_SUBTYPES.has(s) ? "retirement" : "brokerage";
    default:
      return "other_asset";
  }
}

export interface MappedAccount {
  externalAccountId: string;
  type: AccountType;
  displayName: string;
  institution: string | null;
  mask: string | null;
  creditLimit: number | null;
}

/** Fields PFI stores for a Plaid account. Masked identifier only, never a full number. */
export function mapAccount(shape: PlaidAccountShape, institutionName: string | null): MappedAccount {
  const displayName = (shape.officialName ?? "").trim() || shape.name.trim() || "Connected account";
  return {
    externalAccountId: shape.accountId,
    type: mapAccountType(shape.type, shape.subtype),
    displayName,
    institution: institutionName,
    mask: shape.mask,
    creditLimit: shape.balances.limit,
  };
}
