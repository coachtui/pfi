import type { FinancialEvent, ISODate } from "../financial-engine/types";
import { enumerateDays, type Day, type DemoAccount, type DemoTransaction, type DemoDataset } from "./shared";
import { mulberry32 } from "./prng";

export type { DemoAccount, DemoTransaction, DemoDataset } from "./shared";

/**
 * Koa Holdings — deterministic demo profile.
 *
 * 40–49 cohort, higher-income salaried household in a high-cost region.
 * Strong investment contributions, moderate fixed costs, improving
 * liquidity, some revolving credit usage. ~14 months of daily history so
 * 30D / 90D / 1Y ranges all render convincingly.
 *
 * Fixed seed + fixed end date ⇒ the exact same dataset on every run.
 */

export const koaProfile = {
  companyName: "Koa Holdings",
  ticker: "$KOAH",
  username: "IslandBuilder",
  ageCohort: "40–49",
  incomeBand: "$150k–$200k",
  regionCategory: "High-Cost Region",
  objective: "increase_liquidity",
  level: 7,
} as const;

const SEED = 20260715;
const END_DATE: ISODate = "2026-07-15";
const HISTORY_DAYS = 430;

const PAYCHECK = 3200; // semi-monthly, 1st & 15th
const MORTGAGE = 2850; // 1st
const UTILITIES = 380; // 5th
const INSURANCE = 210; // 10th (auto)
const INVESTMENT = 500; // 12th (brokerage contribution)
const CC_PAYMENT = 640; // 13th
const BONUS = 2500; // quarterly on the 20th (Feb, May, Aug, Nov)
const SAFETY_BUFFER = 2500;
const ESSENTIAL_DAILY = 70; // groceries/gas run-rate paid from cash

const BONUS_MONTHS = new Set([2, 5, 8, 11]);

const CHK = "koa-checking";
const CARD = "koa-card";
const BRK = "koa-brokerage";
const PROP = "koa-property";
const MTG = "koa-mortgage";

export function generateKoaHoldings(): DemoDataset {
  const rand = mulberry32(SEED);
  const days = enumerateDays(END_DATE, HISTORY_DAYS);

  let checking = 14_000;
  let card = 2_400;
  let brokerage = 88_000;

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
    const id = `koa-t-${tSeq++}`;
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
    events.push({ id: `koa-${eSeq++}`, date: day.date, type, label, amount, direction });
  };

  const transfer = (day: Day, fromId: string, toId: string, amount: number, description: string) => {
    const outId = `koa-t-${tSeq}`;
    const inId = `koa-t-${tSeq + 1}`;
    pushTxn(day, fromId, amount, "outflow", description, { isTransfer: true, transferPairId: inId });
    pushTxn(day, toId, amount, "inflow", description, { isTransfer: true, transferPairId: outId });
  };

  for (const day of days) {
    const pay = day.y >= 2026 ? PAYCHECK + 250 : PAYCHECK;
    if (day.d === 1 || day.d === 15) {
      checking += pay;
      pushTxn(day, CHK, pay, "inflow", "Employer payroll", { category: "income" });
      pushEvent(day, "paycheck", "Paycheck", pay, "inflow");
    }
    if (day.d === 20 && BONUS_MONTHS.has(day.m)) {
      checking += BONUS;
      pushTxn(day, CHK, BONUS, "inflow", "Quarterly bonus", { category: "income" });
      pushEvent(day, "bonus", "Bonus", BONUS, "inflow");
    }
    if (day.d === 1) {
      checking -= MORTGAGE;
      pushTxn(day, CHK, MORTGAGE, "outflow", "Mortgage payment", { category: "housing", essential: true });
      pushEvent(day, "mortgage_payment", "Mortgage", MORTGAGE, "outflow");
    }
    if (day.d === 5) {
      checking -= UTILITIES;
      pushTxn(day, CHK, UTILITIES, "outflow", "Utilities", { category: "utilities", essential: true });
    }
    if (day.d === 10) {
      checking -= INSURANCE;
      pushTxn(day, CHK, INSURANCE, "outflow", "Auto insurance", { category: "insurance", essential: true });
      pushEvent(day, "insurance_payment", "Auto Insurance", INSURANCE, "outflow");
    }
    if (day.d === 12) {
      checking -= INVESTMENT;
      brokerage += INVESTMENT;
      transfer(day, CHK, BRK, INVESTMENT, "Brokerage contribution");
      pushEvent(day, "investment_contribution", "Investment", INVESTMENT, "outflow");
    }
    if (day.d === 13) {
      const payment = Math.min(CC_PAYMENT, card);
      if (payment > 0) {
        checking -= payment;
        card -= payment;
        transfer(day, CHK, CARD, payment, "Credit card payment");
        pushEvent(day, "debt_payment", "Credit Card", payment, "outflow");
      }
    }

    const essentials = ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 100);
    checking -= essentials;
    pushTxn(day, CHK, essentials, "outflow", "Groceries & essentials", { category: "groceries", essential: true });

    // Mean stays ~$20/day (~$600/mo), just under the $640 CC payment
    const cardSpend = Math.round(4 + rand() * 32);
    card += cardSpend;
    pushTxn(day, CARD, cardSpend, "outflow", "Card purchases", { category: "discretionary", essential: false });

    if (rand() < 0.05) {
      const amount = Math.round(150 + rand() * 300);
      checking -= amount;
      pushTxn(day, CHK, amount, "outflow", "Large purchase", { category: "shopping", essential: false });
      pushEvent(day, "large_purchase", "Large Purchase", amount, "outflow");
    }
  }

  const accounts: DemoAccount[] = [
    { id: CHK, type: "checking", currentBalance: Math.round(checking), includeInCalculations: true, provider: "demo", displayName: "Everyday Checking", institution: "Pacific Bank", subtype: null, mask: "4821" },
    { id: CARD, type: "credit_card", currentBalance: Math.round(card), includeInCalculations: true, provider: "demo", displayName: "Rewards Card", institution: "Pacific Bank", subtype: null, mask: "7710" },
    { id: BRK, type: "brokerage", currentBalance: Math.round(brokerage), includeInCalculations: true, provider: "demo", displayName: "Brokerage", institution: "Island Invest", subtype: null, mask: "0093" },
    { id: PROP, type: "property", currentBalance: 640_000, includeInCalculations: true, provider: "demo", displayName: "Primary Residence", institution: "—", subtype: "primary_residence", mask: "0001" },
    { id: MTG, type: "mortgage", currentBalance: 412_000, includeInCalculations: true, provider: "demo", displayName: "Home Mortgage", institution: "Pacific Bank", subtype: null, mask: "5540" },
  ];

  return {
    profile: koaProfile,
    accounts,
    transactions,
    events,
    config: { startDate: days[0].date, endDate: END_DATE, safetyBuffer: SAFETY_BUFFER },
  };
}
