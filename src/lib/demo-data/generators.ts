import type { DemoDataset } from "./shared";
import type { DemoProfileId } from "./profiles";
import { generateKoaHoldings } from "./koa-holdings";
import { generateBlueReef } from "./blue-reef";
import { generateNorthShore } from "./north-shore";

/** Server-side wiring: profile id → generator. Kept out of profiles.ts so client code never bundles generators. */
export const DEMO_GENERATORS: Record<DemoProfileId, () => DemoDataset> = {
  "koa-holdings": generateKoaHoldings,
  "blue-reef": generateBlueReef,
  "north-shore": generateNorthShore,
};
