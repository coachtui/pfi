/**
 * Conservative cross-account transfer pairing (spec §7). Pure.
 *
 * Two rows pair automatically only when ALL hold: opposite directions, equal
 * amounts to the cent, distinct non-archived accounts, compatible kinds,
 * posted dates within the window, and EXACTLY ONE candidate on each side —
 * a second equal-amount candidate in the window makes the match ambiguous
 * and nothing pairs. A false pairing would silently distort income, spending,
 * and available capital, so ambiguity is left to the user.
 *
 * Only Plaid-classified rows take part (kind comes from Plaid's primary
 * category). csv/demo counterparts have no classification and are never
 * paired here — recorded in KNOWN_LIMITATIONS.
 */
import { LIABILITY_TYPES, type AccountType } from "@/lib/financial-engine";
import type { ISODate } from "./types";

export interface PairCandidate {
  /** Plan-local reference: an existing row id, or `ext:<external_id>` for an insert. */
  ref: string;
  /** Account reference: a PFI account id, or `ext:<external_account_id>` for an account created this sync. */
  accountRef: string;
  accountType: AccountType;
  accountArchived: boolean;
  postedDate: ISODate;
  amount: number;
  direction: "inflow" | "outflow";
  pfcPrimary: string | null;
  /** Already paired rows never re-pair. */
  alreadyPaired: boolean;
}

export interface PairingResult {
  pairs: Array<{ a: string; b: string }>;
  /** Refs that had at least one plausible match but not a unique one. */
  ambiguous: string[];
}

export const PAIR_WINDOW_DAYS = 3;

const TRANSFER_KINDS: ReadonlySet<string> = new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]);

export function dayGap(a: ISODate, b: ISODate): number {
  return Math.abs((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000);
}

function eligible(c: PairCandidate): boolean {
  return !c.alreadyPaired && !c.accountArchived && c.pfcPrimary !== null && TRANSFER_KINDS.has(c.pfcPrimary);
}

/**
 * Kind compatibility, given `out` is the outflow side and `inn` the inflow side:
 * - TRANSFER_OUT ↔ TRANSFER_IN (any account types)
 * - LOAN_PAYMENTS outflow ↔ an inflow on a liability account classified as a
 *   loan payment or transfer-in (how card/loan accounts see the payment land)
 * - TRANSFER_OUT ↔ LOAN_PAYMENTS inflow on a liability account (some
 *   institutions classify the paying side as a plain transfer)
 */
function compatible(out: PairCandidate, inn: PairCandidate): boolean {
  const o = out.pfcPrimary;
  const i = inn.pfcPrimary;
  const innIsLiability = LIABILITY_TYPES.has(inn.accountType);
  if (o === "TRANSFER_OUT" && i === "TRANSFER_IN") return true;
  if (o === "LOAN_PAYMENTS" && innIsLiability && (i === "LOAN_PAYMENTS" || i === "TRANSFER_IN")) return true;
  if (o === "TRANSFER_OUT" && innIsLiability && i === "LOAN_PAYMENTS") return true;
  return false;
}

function matches(out: PairCandidate, inn: PairCandidate, windowDays: number): boolean {
  return (
    out.accountRef !== inn.accountRef &&
    Math.abs(out.amount - inn.amount) < 0.005 &&
    dayGap(out.postedDate, inn.postedDate) <= windowDays &&
    compatible(out, inn)
  );
}

export function pairTransfers(candidates: PairCandidate[], windowDays = PAIR_WINDOW_DAYS): PairingResult {
  const outs = candidates.filter((c) => c.direction === "outflow" && eligible(c));
  const ins = candidates.filter((c) => c.direction === "inflow" && eligible(c));

  const outMatches = new Map<string, PairCandidate[]>();
  const inMatches = new Map<string, PairCandidate[]>();
  for (const o of outs) {
    for (const i of ins) {
      if (!matches(o, i, windowDays)) continue;
      outMatches.set(o.ref, [...(outMatches.get(o.ref) ?? []), i]);
      inMatches.set(i.ref, [...(inMatches.get(i.ref) ?? []), o]);
    }
  }

  const pairs: Array<{ a: string; b: string }> = [];
  const ambiguous = new Set<string>();
  for (const o of outs) {
    const cands = outMatches.get(o.ref) ?? [];
    if (cands.length === 0) continue;
    if (cands.length > 1) { ambiguous.add(o.ref); for (const c of cands) ambiguous.add(c.ref); continue; }
    const i = cands[0];
    const back = inMatches.get(i.ref) ?? [];
    if (back.length !== 1) { ambiguous.add(o.ref); ambiguous.add(i.ref); continue; }
    pairs.push({ a: o.ref, b: i.ref });
  }
  // A ref cannot be both paired and ambiguous: pairing requires mutual uniqueness, so this holds by construction.
  return { pairs, ambiguous: [...ambiguous].sort() };
}
