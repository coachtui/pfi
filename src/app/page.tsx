import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { generateKoaHoldings } from "@/lib/demo-data/koa-holdings";

/**
 * Home dashboard. Phase 1 renders the deterministic Koa Holdings demo
 * dataset; real user data replaces this in Phase 3 (manual data + CSV).
 */
export default function HomePage() {
  const { profile, snapshots, events } = generateKoaHoldings();
  return <HomeDashboard profile={profile} snapshots={snapshots} events={events} />;
}
