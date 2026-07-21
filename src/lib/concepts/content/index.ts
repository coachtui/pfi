// src/lib/concepts/content/index.ts
import type { FinancialConcept } from "../types";
import { revenue } from "./revenue";
import { operatingExpenses } from "./operating-expenses";
import { cashFlow } from "./cash-flow";
import { freeCashFlow } from "./free-cash-flow";
import { savingsRate } from "./savings-rate";

export const ALL_CONCEPTS: FinancialConcept[] = [revenue, operatingExpenses, cashFlow, freeCashFlow, savingsRate];
