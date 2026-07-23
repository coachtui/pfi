// src/lib/concepts/modules.ts
import type { Module } from "./types";

export const MODULES: Module[] = [
  {
    id: "how-your-household-operates",
    title: "How Your Household Operates",
    order: 1,
    conceptIds: ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"],
  },
  {
    id: "reading-your-household-balance-sheet",
    title: "Reading Your Household Balance Sheet",
    order: 2,
    conceptIds: ["assets", "liabilities", "net-worth", "liquidity"],
  },
  {
    id: "financial-pressure-and-flexibility",
    title: "Financial Pressure and Flexibility",
    order: 3,
    conceptIds: [
      "debt-pressure",
      "short-term-obligations",
      "financial-flexibility",
      "retained-cash",
      "capital-allocation",
    ],
  },
  {
    id: "understanding-your-score",
    title: "Understanding Your Score",
    order: 4,
    conceptIds: ["score-index-divergence"],
  },
];
