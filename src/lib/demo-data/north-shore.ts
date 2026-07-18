import type { FinancialEvent, ISODate } from "../financial-engine/types";
import { mulberry32 } from "./prng";
import { enumerateDays, type Day, type DemoAccount, type DemoTransaction, type DemoDataset } from "./shared";

/**
 * North Shore Capital — deterministic demo profile.
 *
 * 50–59 cohort, pre-retirement, debt-free household with a long emergency
 * runway and steady contributions — but ~85%+ of custodial assets held at a
 * single institution. Exists to exercise the debt-free rule, the
 * institution-concentration penalty, and the product's high-band states.
 * Fixed seed + fixed end date ⇒ identical dataset every run.
 */

export const northShoreProfile = {
  companyName: "North Shore Capital",
  ticker: "$NSHC",
  username: "WaveRider",
  ageCohort: "50–59",
  objective: "financial_independence",
} as const;

const SEED = 51900233;
const END_DATE: ISODate = "2026-07-15";
const HISTORY_DAYS = 430;

const SALARY = 6200; // 1st & 15th; +200 from 2026
const BRK_CONTRIB = 2000; // 3rd
const RET_CONTRIB = 1500; // 16th
const HOUSING = 820; // 1st — property tax + HOA (home owned outright)
const UTILITIES = 310; // 8th
const INSURANCE = 290; // 12th
const ESSENTIAL_DAILY = 95;
const SAFETY_BUFFER = 5000;

const CHK = "nsh-checking";
const MM = "nsh-money-market";
const BRK = "nsh-brokerage";
const RET = "nsh-retirement";

export function generateNorthShore(): DemoDataset {
  const rand = mulberry32(SEED);
  const days = enumerateDays(END_DATE, HISTORY_DAYS);

  let checking = 26_000;
  const moneyMarket = 92_000;
  let brokerage = 540_000;
  let retirement = 410_000;

  const transactions: DemoTransaction[] = [];
  const events: FinancialEvent[] = [];
  let tSeq = 0;
  let eSeq = 0;

  const pushTxn = (
    day: Day,
    accountId: string,
    amount: number,
    direction: "inflow" | "outflow",
    description: string,
    opts: { category?: string; essential?: boolean; isTransfer?: boolean; transferPairId?: string | null } = {},
  ): string => {
    const id = `nsh-t-${tSeq++}`;
    transactions.push({
      id, accountId, postedDate: day.date, amount: Math.round(amount * 100) / 100, direction,
      description, category: opts.category ?? null, essential: opts.essential ?? null,
      isTransfer: opts.isTransfer ?? false, transferPairId: opts.transferPairId ?? null,
    });
    return id;
  };

  const pushEvent = (
    day: Day, type: FinancialEvent["type"], label: string, amount: number,
    direction: FinancialEvent["direction"],
  ) => {
    events.push({ id: `nsh-${eSeq++}`, date: day.date, type, label, amount, direction });
  };

  const transfer = (day: Day, fromId: string, toId: string, amount: number, description: string) => {
    const outId = `nsh-t-${tSeq}`;
    const inId = `nsh-t-${tSeq + 1}`;
    pushTxn(day, fromId, amount, "outflow", description, { isTransfer: true, transferPairId: inId });
    pushTxn(day, toId, amount, "inflow", description, { isTransfer: true, transferPairId: outId });
  };

  for (const day of days) {
    const pay = day.y >= 2026 ? SALARY + 200 : SALARY;
    if (day.d === 1 || day.d === 15) {
      checking += pay;
      pushTxn(day, CHK, pay, "inflow", "Employer payroll", { category: "income" });
      pushEvent(day, "paycheck", "Paycheck", pay, "inflow");
    }
    if (day.d === 1) {
      checking -= HOUSING;
      pushTxn(day, CHK, HOUSING, "outflow", "Property tax & HOA", { category: "housing", essential: true });
    }
    if (day.d === 3) {
      checking -= BRK_CONTRIB;
      brokerage += BRK_CONTRIB;
      transfer(day, CHK, BRK, BRK_CONTRIB, "Brokerage contribution");
      pushEvent(day, "investment_contribution", "Investment", BRK_CONTRIB, "outflow");
    }
    if (day.d === 8) {
      checking -= UTILITIES;
      pushTxn(day, CHK, UTILITIES, "outflow", "Utilities", { category: "utilities", essential: true });
    }
    if (day.d === 12) {
      checking -= INSURANCE;
      pushTxn(day, CHK, INSURANCE, "outflow", "Home & auto insurance", { category: "insurance", essential: true });
      pushEvent(day, "insurance_payment", "Insurance", INSURANCE, "outflow");
    }
    if (day.d === 16) {
      checking -= RET_CONTRIB;
      retirement += RET_CONTRIB;
      transfer(day, CHK, RET, RET_CONTRIB, "Retirement contribution");
      pushEvent(day, "investment_contribution", "Retirement", RET_CONTRIB, "outflow");
    }

    const essentials = Math.max(30, ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 40));
    checking -= essentials;
    pushTxn(day, CHK, essentials, "outflow", "Groceries & essentials", { category: "groceries", essential: true });

    if (rand() < 0.28) {
      const amount = Math.round(60 + rand() * 190);
      checking -= amount;
      pushTxn(day, CHK, amount, "outflow", "Dining & leisure", { category: "discretionary", essential: false });
    }
    if (rand() < 0.03) {
      const amount = Math.round(400 + rand() * 600);
      checking -= amount;
      pushTxn(day, CHK, amount, "outflow", "Travel booking", { category: "shopping", essential: false });
      pushEvent(day, "large_purchase", "Large Purchase", amount, "outflow");
    }
  }

  const accounts: DemoAccount[] = [
    { id: CHK, type: "checking", currentBalance: Math.round(checking), includeInCalculations: true, provider: "demo", displayName: "Harbor Checking", institution: "North Bay Bank", subtype: null, mask: "6120" },
    { id: MM, type: "money_market", currentBalance: Math.round(moneyMarket), includeInCalculations: true, provider: "demo", displayName: "Cash Reserve", institution: "North Bay Bank", subtype: null, mask: "6138" },
    { id: BRK, type: "brokerage", currentBalance: Math.round(brokerage), includeInCalculations: true, provider: "demo", displayName: "Brokerage", institution: "Harborview Wealth", subtype: null, mask: "2204" },
    { id: RET, type: "retirement", currentBalance: Math.round(retirement), includeInCalculations: true, provider: "demo", displayName: "Retirement 401(k)", institution: "Harborview Wealth", subtype: "401k", mask: "2212" },
  ];

  return {
    profile: northShoreProfile,
    accounts,
    transactions,
    events,
    config: { startDate: days[0].date, endDate: END_DATE, safetyBuffer: SAFETY_BUFFER },
  };
}
