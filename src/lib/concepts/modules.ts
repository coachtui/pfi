// src/lib/concepts/modules.ts
import type { Module } from "./types";

export const MODULES: Module[] = [
  {
    id: "how-your-household-operates",
    title: "How Your Household Operates",
    order: 1,
    conceptIds: ["revenue", "operating-expenses", "cash-flow", "free-cash-flow", "savings-rate"],
  },
];
