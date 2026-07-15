import type { DailySnapshot, FinancialEvent, ISODate } from "../financial-engine/types";
import { mulberry32 } from "./prng";

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

interface Day {
  date: ISODate;
  y: number;
  m: number; // 1-based
  d: number;
}

function enumerateDays(end: ISODate, count: number): Day[] {
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

const BONUS_MONTHS = new Set([2, 5, 8, 11]);

/** Scheduled cash outflows for a given calendar day (excluding daily run-rate). */
function scheduledOutflows(day: Day): Array<{ amount: number; essential: boolean }> {
  const out: Array<{ amount: number; essential: boolean }> = [];
  if (day.d === 1) out.push({ amount: MORTGAGE, essential: true });
  if (day.d === 5) out.push({ amount: UTILITIES, essential: true });
  if (day.d === 10) out.push({ amount: INSURANCE, essential: true });
  if (day.d === 12) out.push({ amount: INVESTMENT, essential: false });
  if (day.d === 13) out.push({ amount: CC_PAYMENT, essential: false });
  return out;
}

/** Days until the next semi-monthly paycheck (1st or 15th), at least 1. */
function daysToNextPaycheck(day: Day): number {
  if (day.d < 15) return 15 - day.d;
  const daysInMonth = new Date(Date.UTC(day.y, day.m, 0)).getUTCDate();
  return daysInMonth - day.d + 1;
}

export interface DemoDataset {
  profile: typeof koaProfile;
  snapshots: DailySnapshot[];
  events: FinancialEvent[];
}

export function generateKoaHoldings(): DemoDataset {
  const rand = mulberry32(SEED);
  const days = enumerateDays(END_DATE, HISTORY_DAYS);

  let liquid = 14_000;
  let revolving = 2_400;
  let investments = 88_000;
  let mortgageBalance = 412_000;
  const homeValue = 640_000;

  const snapshots: DailySnapshot[] = [];
  const events: FinancialEvent[] = [];
  let eventSeq = 0;

  const pushEvent = (
    day: Day,
    type: FinancialEvent["type"],
    label: string,
    amount: number,
    direction: FinancialEvent["direction"],
  ) => {
    events.push({ id: `koa-${eventSeq++}`, date: day.date, type, label, amount, direction });
  };

  for (const day of days) {
    // Income. A modest raise lands in Jan 2026 to support the improving-liquidity arc.
    const pay = day.y >= 2026 ? PAYCHECK + 250 : PAYCHECK;
    if (day.d === 1 || day.d === 15) {
      liquid += pay;
      pushEvent(day, "paycheck", "Paycheck", pay, "inflow");
    }
    if (day.d === 20 && BONUS_MONTHS.has(day.m)) {
      liquid += BONUS;
      pushEvent(day, "bonus", "Bonus", BONUS, "inflow");
    }

    // Scheduled outflows.
    if (day.d === 1) {
      liquid -= MORTGAGE;
      mortgageBalance -= 620; // principal portion
      pushEvent(day, "mortgage_payment", "Mortgage", MORTGAGE, "outflow");
    }
    if (day.d === 5) {
      liquid -= UTILITIES;
      pushEvent(day, "unexpected_expense", "Utilities", UTILITIES, "outflow");
    }
    if (day.d === 10) {
      liquid -= INSURANCE;
      pushEvent(day, "insurance_payment", "Auto Insurance", INSURANCE, "outflow");
    }
    if (day.d === 12) {
      liquid -= INVESTMENT;
      investments += INVESTMENT;
      pushEvent(day, "investment_contribution", "Investment", INVESTMENT, "outflow");
    }
    if (day.d === 13) {
      const payment = Math.min(CC_PAYMENT, revolving);
      liquid -= payment;
      revolving -= payment;
      if (payment > 0) pushEvent(day, "debt_payment", "Credit Card", payment, "outflow");
    }

    // Daily behavior: essentials from cash, discretionary on the card.
    // Card spend (~$630/mo) sits just under the $640 payment so revolving
    // debt slowly declines — part of the improving-liquidity narrative.
    liquid -= ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 30);
    revolving += Math.round(13 + rand() * 16);

    // Occasional larger one-offs (~ every 6 weeks).
    if (rand() < 0.024) {
      const amount = Math.round(250 + rand() * 450);
      liquid -= amount;
      pushEvent(day, "large_purchase", "Large Purchase", amount, "outflow");
    }

    // Market drift on investments (deterministic noise, slight upward bias).
    investments *= 1 + (rand() - 0.47) * 0.004;

    // Near-term obligations: scheduled bills before the next paycheck plus
    // the essential daily run-rate for those days.
    const gap = daysToNextPaycheck(day);
    let obligations = 0;
    let essential = 0;
    for (let ahead = 1; ahead <= gap; ahead++) {
      const t = new Date(Date.UTC(day.y, day.m - 1, day.d + ahead));
      const future: Day = {
        date: t.toISOString().slice(0, 10),
        y: t.getUTCFullYear(),
        m: t.getUTCMonth() + 1,
        d: t.getUTCDate(),
      };
      for (const o of scheduledOutflows(future)) {
        obligations += o.amount;
        if (o.essential) essential += o.amount;
      }
    }
    obligations += gap * ESSENTIAL_DAILY;
    essential += gap * ESSENTIAL_DAILY;

    snapshots.push({
      date: day.date,
      liquidAssets: Math.round(liquid),
      revolvingBalances: Math.round(revolving),
      nearTermObligations: Math.round(obligations),
      essentialObligations: Math.round(essential),
      safetyBuffer: SAFETY_BUFFER,
      netWorth: Math.round(liquid + investments + homeValue - revolving - mortgageBalance),
    });
  }

  return { profile: koaProfile, snapshots, events };
}
