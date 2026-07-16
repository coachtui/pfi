import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";
import { applyOverride, parseOverride } from "@/lib/financial-engine";
import {
  rowToSnapshot, rowToEvent, rowToTransactionListItem,
  rowToAccountSummary, type SnapshotRow, type EventRow, type TransactionRow,
  type TransactionListRow, type AccountRow, type AccountSummary, type TransactionListItem,
} from "./mappers";
import type { TransactionFilters } from "@/lib/validation/transactions";

export interface ProfileRow {
  id: string; username: string; age_cohort: string; income_band: string;
  household_type: string; col_cohort: string; objective: string;
  onboarding_completed_at: string | null;
}

export interface CompanyRow { id: string; user_id: string; name: string; ticker: string; }

export async function getProfile(supabase: SupabaseClient): Promise<ProfileRow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("user_profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCompany(supabase: SupabaseClient): Promise<CompanyRow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("personal_companies").select("*").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAccountsData(supabase: SupabaseClient): Promise<AccountSummary[]> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("id, provider, institution, type, display_name, mask, current_balance, credit_limit, interest_rate, include_in_calculations, archived_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as AccountRow[]).map(rowToAccountSummary);
}

export async function getTransactionsData(
  supabase: SupabaseClient,
  filters: TransactionFilters,
): Promise<{ transactions: TransactionListItem[]; accounts: AccountSummary[] }> {
  let query = supabase
    .from("transactions")
    .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, notes, user_override, financial_accounts!inner(display_name, provider)")
    .order("posted_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (filters.account) query = query.eq("account_id", filters.account);
  if (filters.from) query = query.gte("posted_date", filters.from);
  if (filters.to) query = query.lte("posted_date", filters.to);

  const [txnRes, accounts] = await Promise.all([query, getAccountsData(supabase)]);
  if (txnRes.error) throw txnRes.error;

  // Category/direction filter on *effective* values: overrides live in jsonb,
  // so SQL filters on the source column would miss corrections.
  let items = (txnRes.data as unknown as TransactionListRow[]).map(rowToTransactionListItem);
  if (filters.category) items = items.filter((t) => t.category === filters.category);
  if (filters.direction) items = items.filter((t) => t.direction === filters.direction);
  return { transactions: items, accounts };
}

export async function getDashboardData(
  supabase: SupabaseClient,
): Promise<{ snapshots: DailySnapshot[]; events: FinancialEvent[]; staleIndex: boolean }> {
  const [snapRes, eventRes, latestTxnRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
    supabase.from("transactions").select("posted_date").order("posted_date", { ascending: false }).limit(1),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (eventRes.error) throw eventRes.error;
  if (latestTxnRes.error) throw latestTxnRes.error;

  const snapshots = (snapRes.data as SnapshotRow[]).map(rowToSnapshot);
  const latestTxnDate = latestTxnRes.data?.[0]?.posted_date as string | undefined;
  const latestSnapDate = snapshots.at(-1)?.date;
  // Cheap divergence proxy: a transaction newer than the newest snapshot means
  // a rebuild is pending/failed. (Historical inserts with a failed rebuild are
  // caught by the retry-on-mutation path — see KNOWN_LIMITATIONS.)
  const staleIndex = latestTxnDate !== undefined && (latestSnapDate === undefined || latestTxnDate > latestSnapDate);

  return {
    snapshots,
    events: (eventRes.data as Array<EventRow & { id: string }>).map(rowToEvent),
    staleIndex,
  };
}

export async function getReportData(supabase: SupabaseClient): Promise<{
  snapshots: DailySnapshot[]; transactions: TransactionInput[]; events: FinancialEvent[];
}> {
  const [snapRes, txnRes, eventRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase
      .from("transactions")
      .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, notes, user_override")
      .order("posted_date", { ascending: true }),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (txnRes.error) throw txnRes.error;
  if (eventRes.error) throw eventRes.error;
  return {
    snapshots: (snapRes.data as SnapshotRow[]).map(rowToSnapshot),
    transactions: (txnRes.data as Array<TransactionRow & { description: string; notes: string | null; user_override: unknown }>).map((row) => {
      const effective = applyOverride({
        id: row.id, accountId: row.account_id, postedDate: row.posted_date,
        amount: Number(row.amount), direction: row.direction as "inflow" | "outflow",
        description: row.description, category: row.category, essential: row.essential,
        isTransfer: row.is_transfer, transferPairId: row.transfer_pair_id,
        userOverride: parseOverride(row.user_override),
      });
      return {
        id: effective.id, accountId: effective.accountId, postedDate: effective.postedDate,
        amount: effective.amount, direction: effective.direction, category: effective.category,
        essential: effective.essential, isTransfer: effective.isTransfer,
        transferPairId: effective.transferPairId,
      };
    }),
    events: (eventRes.data as Array<EventRow & { id: string }>).map(rowToEvent),
  };
}
