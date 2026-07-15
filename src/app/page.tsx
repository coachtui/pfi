import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { buildDailySnapshots } from "@/lib/financial-engine";
import { generateKoaHoldings } from "@/lib/demo-data/koa-holdings";

// Temporary: still in-memory. Task 12 swaps this for Supabase queries.
export default function HomePage() {
  const { profile, accounts, transactions, events, config } = generateKoaHoldings();
  const snapshots = buildDailySnapshots(accounts, transactions, config);
  return <HomeDashboard profile={profile} snapshots={snapshots} events={events} />;
}
