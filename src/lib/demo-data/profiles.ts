/**
 * Client-safe demo-profile metadata registry. Deliberately imports NO
 * generator code so UI components can use it without pulling generators
 * into the client bundle. Generator wiring lives in ./generators.ts.
 */

export type DemoProfileId = "koa-holdings" | "blue-reef" | "north-shore";

export interface DemoProfileMeta {
  id: DemoProfileId;
  companyName: string;
  ticker: string;
  username: string;
  /** One-line persona summary for demo-data UI. Fictional; no shame language. */
  description: string;
  /** A displayName unique to this profile's seeded accounts; used for active-profile detection. */
  signatureAccountName: string;
}

export const DEMO_PROFILE_METAS: DemoProfileMeta[] = [
  {
    id: "koa-holdings",
    companyName: "Koa Holdings",
    ticker: "$KOAH",
    username: "IslandBuilder",
    description: "Mid-career household: steady paychecks, investing regularly, improving liquidity.",
    signatureAccountName: "Everyday Checking",
  },
  {
    id: "blue-reef",
    companyName: "Blue Reef Partners",
    ticker: "$BRFP",
    username: "CoralTrader",
    description: "Early-career renter: irregular income, tight margins, working on debt.",
    signatureAccountName: "Reef Checking",
  },
  {
    id: "north-shore",
    companyName: "North Shore Capital",
    ticker: "$NSHC",
    username: "WaveRider",
    description: "Pre-retirement household: debt-free, long runway, assets concentrated at one firm.",
    signatureAccountName: "Harbor Checking",
  },
];

export const DEFAULT_PROFILE_ID: DemoProfileId = "koa-holdings";

const IDS = new Set<string>(DEMO_PROFILE_METAS.map((m) => m.id));

export function isDemoProfileId(v: unknown): v is DemoProfileId {
  return typeof v === "string" && IDS.has(v);
}

/** Match seeded demo-account display names against profile signatures. */
export function detectActiveProfile(demoAccountNames: string[]): DemoProfileId | null {
  const names = new Set(demoAccountNames);
  for (const m of DEMO_PROFILE_METAS) {
    if (names.has(m.signatureAccountName)) return m.id;
  }
  return null;
}
