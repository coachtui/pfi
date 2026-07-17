import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";
import {
  applyOverride, parseOverride,
  buildMetricInputs, computeMetrics, computeConfidence, computeScore,
  computeScoreDelta, computeScoreMomentum, addDays,
  type MomentumState, type OverallState, type ScoreBreakdown, type ScoreDelta,
  type ScoreAccountInput, type ScoreTransactionInput,
} from "@/lib/financial-engine";
import {
  rowToSnapshot, rowToEvent, rowToTransactionListItem,
  rowToAccountSummary, type SnapshotRow, type EventRow, type TransactionRow,
  type TransactionListRow, type AccountRow, type AccountSummary, type TransactionListItem,
} from "./mappers";
import type { TransactionFilters } from "@/lib/validation/transactions";
import { percentToDecimal } from "./unit-conversions";

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
): Promise<{
  snapshots: DailySnapshot[]; events: FinancialEvent[]; staleIndex: boolean;
  scoreSummary: ScoreSummary;
}> {
  const [snapRes, eventRes, latestTxnRes, scoreSummary] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
    supabase.from("transactions").select("posted_date").order("posted_date", { ascending: false }).limit(1),
    getScoreSummary(supabase),
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
    scoreSummary,
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

export type ScoreRange = "30d" | "90d" | "1y" | "all";

export interface ScoreSummary {
  state: OverallState;
  overall: number | null;
  band: string | null;
  momentum: MomentumState;
  confidence: ScoreBreakdown["overallConfidence"];
}

export interface ScoreData {
  breakdown: ScoreBreakdown;
  delta: ScoreDelta;
  momentum: MomentumState;
  improvements: string[];
  range: ScoreRange;
}

interface ScoreSourceRows {
  snapshots: DailySnapshot[];
  transactions: ScoreTransactionInput[];
  accounts: ScoreAccountInput[];
  events: FinancialEvent[];
}

async function fetchScoreSources(supabase: SupabaseClient): Promise<ScoreSourceRows> {
  const [snapRes, txnRes, acctRes, eventRes] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("date", { ascending: true }),
    supabase
      .from("transactions")
      .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, user_override")
      .order("posted_date", { ascending: true }),
    supabase
      .from("financial_accounts")
      .select("id, type, institution, provider, current_balance, credit_limit, interest_rate, include_in_calculations, archived_at"),
    supabase.from("financial_events").select("*").order("date", { ascending: true }),
  ]);
  if (snapRes.error) throw snapRes.error;
  if (txnRes.error) throw txnRes.error;
  if (acctRes.error) throw acctRes.error;
  if (eventRes.error) throw eventRes.error;

  return {
    snapshots: (snapRes.data as SnapshotRow[]).map(rowToSnapshot),
    transactions: (txnRes.data as Array<TransactionRow & { description: string; user_override: unknown }>).map((row) => {
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
        transferPairId: effective.transferPairId, description: effective.description,
      };
    }),
    accounts: (acctRes.data as Array<{
      id: string; type: string; institution: string | null; provider: string;
      current_balance: number | string; credit_limit: number | string | null;
      interest_rate: number | string | null; include_in_calculations: boolean;
      archived_at: string | null;
    }>)
      .filter((row) => row.archived_at === null)
      .map((row) => ({
        id: row.id,
        type: row.type as ScoreAccountInput["type"],
        institution: row.institution,
        currentBalance: Number(row.current_balance),
        creditLimit: row.credit_limit === null ? null : Number(row.credit_limit),
        // Stored as a percent (per src/lib/validation/transactions.ts's accountSchema,
        // e.g. 6.25 meaning 6.25%); the engine's interest-burden metric expects a
        // decimal APR (0.0625), so convert at this data boundary only.
        interestRate: percentToDecimal(row.interest_rate === null ? null : Number(row.interest_rate)),
        includeInCalculations: row.include_in_calculations,
        provider: row.provider,
      })),
    events: (eventRes.data as Array<EventRow & { id: string }>).map(rowToEvent),
  };
}

function breakdownAt(sources: ScoreSourceRows, asOf: string): ScoreBreakdown {
  const inputs = buildMetricInputs(sources.snapshots, sources.transactions, sources.accounts, asOf);
  const results = computeMetrics(inputs);
  const confidence = computeConfidence(inputs, results);
  return computeScore(results, confidence.byDimension, asOf);
}

function improvementsAt(sources: ScoreSourceRows, asOf: string): string[] {
  const inputs = buildMetricInputs(sources.snapshots, sources.transactions, sources.accounts, asOf);
  return computeConfidence(inputs, computeMetrics(inputs)).improvements;
}

const RANGE_DAYS: Record<Exclude<ScoreRange, "all">, number> = { "30d": 30, "90d": 90, "1y": 365 };

export async function getScoreData(supabase: SupabaseClient, range: ScoreRange): Promise<ScoreData> {
  const sources = await fetchScoreSources(supabase);
  const asOf = sources.snapshots.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const breakdown = breakdownAt(sources, asOf);

  const firstDate = sources.snapshots[0]?.date ?? asOf;
  const rangeStart = range === "all" ? firstDate : addDays(asOf, -RANGE_DAYS[range]);
  const previous = rangeStart < asOf && rangeStart >= firstDate ? breakdownAt(sources, rangeStart) : null;
  // One-time events strictly after the range start, through (inclusive of) the as-of date.
  const periodEvents = sources.events.filter((e) => e.date > rangeStart && e.date <= asOf);
  const delta = computeScoreDelta(breakdown, previous, periodEvents);

  const momentum = computeScoreMomentum({
    current: breakdown.overall,
    prior30: breakdownAt(sources, addDays(asOf, -30)).overall,
    prior60: breakdownAt(sources, addDays(asOf, -60)).overall,
  });

  return { breakdown, delta, momentum, improvements: improvementsAt(sources, asOf), range };
}

export async function getScoreSummary(supabase: SupabaseClient): Promise<ScoreSummary> {
  const sources = await fetchScoreSources(supabase);
  const asOf = sources.snapshots.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const breakdown = breakdownAt(sources, asOf);
  const momentum = computeScoreMomentum({
    current: breakdown.overall,
    prior30: breakdownAt(sources, addDays(asOf, -30)).overall,
    prior60: breakdownAt(sources, addDays(asOf, -60)).overall,
  });
  return {
    state: breakdown.state, overall: breakdown.overall, band: breakdown.band,
    momentum, confidence: breakdown.overallConfidence,
  };
}
