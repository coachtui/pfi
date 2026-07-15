import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";
import { rowToSnapshot, rowToEvent, rowToTransactionInput, type SnapshotRow, type EventRow, type TransactionRow } from "./mappers";

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

export async function getDashboardData(
  supabase: SupabaseClient,
): Promise<{ snapshots: DailySnapshot[]; events: FinancialEvent[] }> {
  const [snapRes, eventRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (eventRes.error) throw eventRes.error;
  return {
    snapshots: (snapRes.data as SnapshotRow[]).map(rowToSnapshot),
    events: (eventRes.data as Array<EventRow & { id: string }>).map(rowToEvent),
  };
}

export async function getReportData(supabase: SupabaseClient): Promise<{
  snapshots: DailySnapshot[]; transactions: TransactionInput[]; events: FinancialEvent[];
}> {
  const [snapRes, txnRes, eventRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase
      .from("transactions")
      .select("id, account_id, posted_date, amount, direction, category, essential, is_transfer, transfer_pair_id")
      .order("posted_date", { ascending: true }),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (txnRes.error) throw txnRes.error;
  if (eventRes.error) throw eventRes.error;
  return {
    snapshots: (snapRes.data as SnapshotRow[]).map(rowToSnapshot),
    transactions: (txnRes.data as TransactionRow[]).map(rowToTransactionInput),
    events: (eventRes.data as Array<EventRow & { id: string }>).map(rowToEvent),
  };
}
