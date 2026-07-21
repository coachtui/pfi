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
];
