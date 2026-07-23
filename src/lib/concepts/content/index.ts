// src/lib/concepts/content/index.ts
import type { FinancialConcept } from "../types";
import { revenue } from "./revenue";
import { operatingExpenses } from "./operating-expenses";
import { cashFlow } from "./cash-flow";
import { freeCashFlow } from "./free-cash-flow";
import { savingsRate } from "./savings-rate";
import { assets } from "./assets";
import { liabilities } from "./liabilities";
import { netWorth } from "./net-worth";
import { liquidity } from "./liquidity";
import { debtPressure } from "./debt-pressure";
import { shortTermObligations } from "./short-term-obligations";
import { financialFlexibility } from "./financial-flexibility";
import { retainedCash } from "./retained-cash";
import { capitalAllocation } from "./capital-allocation";
import { availableCapital } from "./available-capital";
import { scoreIndexDivergence } from "./score-index-divergence";

export const ALL_CONCEPTS: FinancialConcept[] = [
  revenue,
  operatingExpenses,
  cashFlow,
  freeCashFlow,
  savingsRate,
  assets,
  liabilities,
  netWorth,
  liquidity,
  debtPressure,
  shortTermObligations,
  financialFlexibility,
  retainedCash,
  capitalAllocation,
  availableCapital,
  scoreIndexDivergence,
];
