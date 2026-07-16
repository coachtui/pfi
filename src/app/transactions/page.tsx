import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getTransactionsData } from "@/lib/data/queries";
import { parseTransactionFilters } from "@/lib/validation/transactions";
import { TransactionsView } from "./TransactionsView";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");

  const sp = await searchParams;
  const filters = parseTransactionFilters(sp);
  const { transactions, accounts } = await getTransactionsData(supabase, filters);

  return (
    <TransactionsView
      transactions={transactions}
      accounts={accounts}
      filters={filters}
      contextLabel={typeof sp.label === "string" ? sp.label : null}
    />
  );
}
