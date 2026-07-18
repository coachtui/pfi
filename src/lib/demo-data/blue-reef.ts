import type { FinancialEvent, ISODate } from "../financial-engine/types";
import { mulberry32 } from "./prng";
import { enumerateDays, type Day, type DemoAccount, type DemoTransaction, type DemoDataset } from "./shared";

/**
 * Blue Reef Partners — deterministic demo profile.
 *
 * 20–29 cohort, early-career renter under strain in a high-cost region.
 * Irregular income (small part-time paycheck + gig deposits), high-utilization
 * credit card, student loan, near-zero investment contributions, thin savings.
 * Exists to exercise the product's low-band / below-waterline / high-utilization
 * states honestly. Fixed seed + fixed end date ⇒ identical dataset every run.
 */

export const blueReefProfile = {
  companyName: "Blue Reef Partners",
  ticker: "$BRFP",
  username: "CoralTrader",
  ageCohort: "20–29",
  objective: "reduce_debt",
} as const;

const SEED = 84121347;
const END_DATE: ISODate = "2026-07-15";
const HISTORY_DAYS = 430;

const PAYCHECK = 980; // part-time, 7th & 21st; +140 raise from 2026
const RENT = 1150; // 1st
const UTILITIES = 145; // 6th
const PHONE = 68; // 18th
const STREAMING = 32; // 11th
const LOAN_PAYMENT = 180; // 5th (student loan)
const CARD_PAYMENT = 500; // 15th
const ESSENTIAL_DAILY = 26;
const SAFETY_BUFFER = 800;

const CHK = "brf-checking";
const SAV = "brf-savings";
const CARD = "brf-card";
const LOAN = "brf-student-loan";

export function generateBlueReef(): DemoDataset {
  const rand = mulberry32(SEED);
  const days = enumerateDays(END_DATE, HISTORY_DAYS);

  let checking = 1_400;
  const savings = 850;
  let card = 4_300;
  let loan = 17_600;

  const transactions: DemoTransaction[] = [];
  const events: FinancialEvent[] = [];
  let tSeq = 0;
  let eSeq = 0;
  let gigSeq = 100;

  const pushTxn = (
    day: Day,
    accountId: string,
    amount: number,
    direction: "inflow" | "outflow",
    description: string,
    opts: { category?: string; essential?: boolean; isTransfer?: boolean; transferPairId?: string | null } = {},
  ): string => {
    const id = `brf-t-${tSeq++}`;
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
    events.push({ id: `brf-${eSeq++}`, date: day.date, type, label, amount, direction });
  };

  const transfer = (day: Day, fromId: string, toId: string, amount: number, description: string) => {
    const outId = `brf-t-${tSeq}`;
    const inId = `brf-t-${tSeq + 1}`;
    pushTxn(day, fromId, amount, "outflow", description, { isTransfer: true, transferPairId: inId });
    pushTxn(day, toId, amount, "inflow", description, { isTransfer: true, transferPairId: outId });
  };

  for (const day of days) {
    const pay = day.y >= 2026 ? PAYCHECK + 140 : PAYCHECK;
    if (day.d === 7 || day.d === 21) {
      checking += pay;
      pushTxn(day, CHK, pay, "inflow", "Employer payroll", { category: "income" });
      pushEvent(day, "paycheck", "Paycheck", pay, "inflow");
    }
    // Irregular gig income: distinct descriptions so each deposit reads as a
    // one-off source (Stability's irregular-income metrics must see it).
    if (rand() < 0.18) {
      const amount = Math.round(45 + rand() * 230);
      checking += amount;
      pushTxn(day, CHK, amount, "inflow", `Gig payout #${gigSeq++}`, { category: "income" });
    }
    if (day.d === 1) {
      checking -= RENT;
      pushTxn(day, CHK, RENT, "outflow", "Rent", { category: "housing", essential: true });
    }
    if (day.d === 6) {
      checking -= UTILITIES;
      pushTxn(day, CHK, UTILITIES, "outflow", "Utilities", { category: "utilities", essential: true });
    }
    if (day.d === 18) {
      checking -= PHONE;
      pushTxn(day, CHK, PHONE, "outflow", "Phone plan", { category: "utilities", essential: true });
    }
    if (day.d === 11) {
      checking -= STREAMING;
      pushTxn(day, CHK, STREAMING, "outflow", "Streaming subscriptions", { category: "discretionary", essential: false });
    }
    if (day.d === 5) {
      checking -= LOAN_PAYMENT;
      loan -= LOAN_PAYMENT;
      transfer(day, CHK, LOAN, LOAN_PAYMENT, "Student loan payment");
      pushEvent(day, "debt_payment", "Student Loan", LOAN_PAYMENT, "outflow");
    }
    if (day.d === 15) {
      const payment = Math.min(CARD_PAYMENT, card);
      if (payment > 0) {
        checking -= payment;
        card -= payment;
        transfer(day, CHK, CARD, payment, "Credit card payment");
        pushEvent(day, "debt_payment", "Credit Card", payment, "outflow");
      }
    }

    const essentials = Math.max(6, ESSENTIAL_DAILY + Math.round((rand() - 0.5) * 14));
    checking -= essentials;
    pushTxn(day, CHK, essentials, "outflow", "Groceries & essentials", { category: "groceries", essential: true });

    // Card spend averages ~$19/day (~$580/mo), slightly above the $500 payment,
    // so utilization stays high and drifts upward — the persona's core strain.
    const cardSpend = Math.round(6 + rand() * 26);
    card += cardSpend;
    pushTxn(day, CARD, cardSpend, "outflow", "Card purchases", { category: "discretionary", essential: false });

    if (rand() < 0.04) {
      const amount = Math.round(120 + rand() * 260);
      checking -= amount;
      pushTxn(day, CHK, amount, "outflow", "Unexpected expense", { category: "shopping", essential: false });
      pushEvent(day, "unexpected_expense", "Unexpected Expense", amount, "outflow");
    }
  }

  const accounts: DemoAccount[] = [
    { id: CHK, type: "checking", currentBalance: Math.round(checking), includeInCalculations: true, provider: "demo", displayName: "Reef Checking", institution: "Harbor Community Bank", subtype: null, mask: "3308" },
    { id: SAV, type: "savings", currentBalance: Math.round(savings), includeInCalculations: true, provider: "demo", displayName: "Rainy Day Savings", institution: "Harbor Community Bank", subtype: null, mask: "3316" },
    { id: CARD, type: "credit_card", currentBalance: Math.round(card), includeInCalculations: true, provider: "demo", displayName: "Reef Rewards Card", institution: "Harbor Community Bank", subtype: null, mask: "9012", creditLimit: 5_000, interestRate: 26.99 },
    { id: LOAN, type: "student_loan", currentBalance: Math.round(loan), includeInCalculations: true, provider: "demo", displayName: "Student Loan", institution: "EduServe", subtype: null, mask: "7745", interestRate: 5.5 },
  ];

  return {
    profile: blueReefProfile,
    accounts,
    transactions,
    events,
    config: { startDate: days[0].date, endDate: END_DATE, safetyBuffer: SAFETY_BUFFER },
  };
}
