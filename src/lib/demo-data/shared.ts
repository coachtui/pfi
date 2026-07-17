import type { FinancialEvent, ISODate } from "../financial-engine/types";
import type {
  AccountInput,
  SnapshotBuilderConfig,
  TransactionInput,
} from "../financial-engine/snapshot-builder";

/** Decorative identity carried by a demo dataset; never written to user rows. */
export interface DemoProfileBase {
  companyName: string;
  ticker: string;
  username: string;
}

export interface Day {
  date: ISODate;
  y: number;
  m: number; // 1-based
  d: number;
}

export function enumerateDays(end: ISODate, count: number): Day[] {
  const [y, m, d] = end.split("-").map(Number);
  const endUtc = Date.UTC(y, m - 1, d);
  const days: Day[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = new Date(endUtc - i * 86_400_000);
    days.push({
      date: t.toISOString().slice(0, 10),
      y: t.getUTCFullYear(),
      m: t.getUTCMonth() + 1,
      d: t.getUTCDate(),
    });
  }
  return days;
}

export interface DemoAccount extends AccountInput {
  provider: "demo";
  displayName: string;
  institution: string;
  subtype: string | null;
  mask: string;
  /** Credit limit in dollars; only meaningful for credit_card accounts. */
  creditLimit?: number | null;
  /** APR in PERCENT (e.g. 26.99) to match the financial_accounts column; the read boundary converts to decimal. */
  interestRate?: number | null;
}

export interface DemoTransaction extends TransactionInput {
  description: string;
}

export interface DemoDataset {
  profile: DemoProfileBase;
  accounts: DemoAccount[];
  transactions: DemoTransaction[];
  events: FinancialEvent[];
  config: SnapshotBuilderConfig;
}
