import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailySnapshot, FinancialEvent } from "@/lib/financial-engine/types";
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";
import type { ExistingTxn } from "@/lib/csv-import/types";
import {
  applyOverride, parseOverride,
  buildMetricInputs, computeMetrics, computeConfidence, computeScore,
  computeScoreDelta, computeScoreMomentum, addDays,
  detectRecurringSeries,
  effectiveAnchor, accountFreshness, householdFreshness, nudgeVisible,
  type MomentumState, type OverallState, type ScoreBreakdown, type ScoreDelta,
  type ScoreAccountInput, type ScoreTransactionInput,
  type RecurringSeries, type AccountInput, type AccountType,
  type BalanceAnchor, type AccountFreshnessInput,
} from "@/lib/financial-engine";
import {
  rowToSnapshot, rowToEvent, rowToTransactionListItem, rowToTransactionInput,
  rowToAccountSummary, type SnapshotRow, type EventRow, type TransactionRow,
  type TransactionListRow, type AccountRow, type AccountSummary, type TransactionListItem,
  type RecentImport,
} from "./mappers";
import type { TransactionFilters } from "@/lib/validation/transactions";
import { percentToDecimal } from "./unit-conversions";
import { paginateSelect } from "./paginate";
import type { CheckResponse, ProgressRow } from "@/lib/concepts/progress";

// PostgREST caps unbounded selects at 1000 rows (see DECISIONS #18–#21).
// Every select in this file on a table that grows without bound per user
// (transactions, daily_snapshots, financial_events) goes through
// paginateSelect with this page size and a stable, unique .order() —
// financial_accounts stays unpaginated (bounded by household scale).
const TRANSACTIONS_PAGE_SIZE = 1000;

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
  const [rows, accounts] = await Promise.all([
    paginateSelect<TransactionListRow>(TRANSACTIONS_PAGE_SIZE, (from, to) => {
      let query = supabase
        .from("transactions")
        .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, notes, user_override, import_batch_id, financial_accounts!inner(display_name, provider)")
        .order("posted_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }); // unique tiebreaker: posted_date/created_at ties would make .range() pages unstable
      if (filters.account) query = query.eq("account_id", filters.account);
      if (filters.from) query = query.gte("posted_date", filters.from);
      if (filters.to) query = query.lte("posted_date", filters.to);
      return query.range(from, to) as unknown as PromiseLike<{ data: TransactionListRow[] | null; error: { message: string } | null }>;
    }),
    getAccountsData(supabase),
  ]);

  // Category/direction filter on *effective* values: overrides live in jsonb,
  // so SQL filters on the source column would miss corrections.
  let items = rows.map(rowToTransactionListItem);
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
  const [snapRows, eventRows, latestTxnRes, scoreSummary] = await Promise.all([
    paginateSelect<SnapshotRow>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      // date alone is a unique order here only because RLS scopes rows to one
      // user (PK is (user_id, date)) — do not reuse with a service-role client.
      supabase.from("daily_snapshots").select("*").order("date", { ascending: true }).range(from, to)),
    paginateSelect<EventRow & { id: string }>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      supabase.from("financial_events").select("*")
        .order("date", { ascending: true })
        .order("id", { ascending: true }) // unique tiebreaker: several events can share a date
        .range(from, to)),
    supabase.from("transactions").select("posted_date").order("posted_date", { ascending: false }).limit(1),
    getScoreSummary(supabase),
  ]);
  if (latestTxnRes.error) throw latestTxnRes.error;

  const snapshots = snapRows.map(rowToSnapshot);
  const latestTxnDate = latestTxnRes.data?.[0]?.posted_date as string | undefined;
  const latestSnapDate = snapshots.at(-1)?.date;
  // Cheap divergence proxy: a transaction newer than the newest snapshot means
  // a rebuild is pending/failed. (Historical inserts with a failed rebuild are
  // caught by the retry-on-mutation path — see KNOWN_LIMITATIONS.)
  const staleIndex = latestTxnDate !== undefined && (latestSnapDate === undefined || latestTxnDate > latestSnapDate);

  return {
    snapshots,
    events: eventRows.map(rowToEvent),
    staleIndex,
    scoreSummary,
  };
}

export async function getReportData(supabase: SupabaseClient): Promise<{
  snapshots: DailySnapshot[]; transactions: TransactionInput[]; events: FinancialEvent[];
}> {
  const [snapRows, txnRows, eventRows] = await Promise.all([
    paginateSelect<SnapshotRow>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      // date alone is a unique order here only because RLS scopes rows to one
      // user (PK is (user_id, date)) — do not reuse with a service-role client.
      supabase.from("daily_snapshots").select("*").order("date", { ascending: true }).range(from, to)),
    paginateSelect<TransactionRow & { description: string; notes: string | null; user_override: unknown }>(
      TRANSACTIONS_PAGE_SIZE, (from, to) =>
        supabase
          .from("transactions")
          .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, notes, user_override")
          .order("posted_date", { ascending: true })
          .order("id", { ascending: true }) // unique tiebreaker for stable pages
          .range(from, to)),
    paginateSelect<EventRow & { id: string }>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      supabase.from("financial_events").select("*")
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)),
  ]);
  return {
    snapshots: snapRows.map(rowToSnapshot),
    transactions: txnRows.map((row) => {
      const effective = applyOverride({
        id: row.id, accountId: row.account_id, postedDate: row.posted_date,
        amount: Number(row.amount), direction: row.direction as "inflow" | "outflow",
        description: row.description, category: row.category, essential: row.essential,
        isTransfer: row.is_transfer, transferPairId: row.transfer_pair_id,
        userOverride: parseOverride(row.user_override),
      });
      return {
        id: effective.id, accountId: effective.accountId, postedDate: effective.postedDate,
        amount: effective.amount, direction: effective.direction, description: effective.description,
        category: effective.category, essential: effective.essential, isTransfer: effective.isTransfer,
        transferPairId: effective.transferPairId,
      };
    }),
    events: eventRows.map(rowToEvent),
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
  const [snapRows, txnRows, acctRes, eventRows] = await Promise.all([
    paginateSelect<SnapshotRow>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      // date alone is a unique order here only because RLS scopes rows to one
      // user (PK is (user_id, date)) — do not reuse with a service-role client.
      supabase.from("daily_snapshots").select("*").order("date", { ascending: true }).range(from, to)),
    paginateSelect<TransactionRow & { description: string; user_override: unknown }>(
      TRANSACTIONS_PAGE_SIZE, (from, to) =>
        supabase
          .from("transactions")
          .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id, user_override")
          .order("posted_date", { ascending: true })
          .order("id", { ascending: true }) // unique tiebreaker for stable pages
          .range(from, to)),
    // financial_accounts stays unpaginated: bounded by household scale, nowhere near the row cap.
    supabase
      .from("financial_accounts")
      .select("id, type, institution, provider, current_balance, credit_limit, interest_rate, include_in_calculations, archived_at"),
    paginateSelect<EventRow & { id: string }>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      supabase.from("financial_events").select("*")
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)),
  ]);
  if (acctRes.error) throw acctRes.error;

  return {
    snapshots: snapRows.map(rowToSnapshot),
    transactions: txnRows.map((row) => {
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
    events: eventRows.map(rowToEvent),
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

/** Everything the /import wizard needs: candidate target accounts and the
 * user's existing transactions (source values) for dedupe + transfer detection. */
export async function getImportContext(
  supabase: SupabaseClient,
): Promise<{ accounts: AccountSummary[]; existing: ExistingTxn[]; anchors: Record<string, { anchorDate: string; balance: number }> }> {
  const [acctRes, txnRows, anchorRows] = await Promise.all([
    supabase.from("financial_accounts").select(
      "id, provider, institution, type, display_name, mask, current_balance, credit_limit, interest_rate, include_in_calculations, archived_at",
    ),
    paginateSelect<{
      id: string; account_id: string; posted_date: string; amount: number;
      direction: string; description: string; is_transfer: boolean; transfer_pair_id: string | null;
    }>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      supabase.from("transactions")
        .select("id, account_id, posted_date, amount, direction, description, is_transfer, transfer_pair_id")
        .order("id", { ascending: true })
        .range(from, to)),
    paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(
      TRANSACTIONS_PAGE_SIZE,
      (from, to) =>
        supabase.from("balance_anchors")
          .select("account_id, anchor_date, balance, created_at")
          .order("id", { ascending: true })
          .range(from, to)),
  ]);
  if (acctRes.error) throw new Error(acctRes.error.message);
  const accounts = (acctRes.data as AccountRow[])
    .map(rowToAccountSummary)
    .filter((a) => a.provider !== "demo" && a.archivedAt === null);
  const existing: ExistingTxn[] = txnRows.map((t) => ({
    id: t.id, accountId: t.account_id, postedDate: t.posted_date,
    amount: Number(t.amount), direction: t.direction as "inflow" | "outflow",
    description: t.description, isTransfer: t.is_transfer, transferPairId: t.transfer_pair_id,
  }));
  const anchorsByAccount = new Map<string, BalanceAnchor[]>();
  for (const r of anchorRows) {
    const list = anchorsByAccount.get(r.account_id) ?? [];
    list.push({ accountId: r.account_id, anchorDate: r.anchor_date, balance: Number(r.balance), createdAt: r.created_at });
    anchorsByAccount.set(r.account_id, list);
  }
  const anchors: Record<string, { anchorDate: string; balance: number }> = {};
  for (const [accountId, list] of anchorsByAccount) {
    const eff = effectiveAnchor(list);
    if (eff) anchors[accountId] = { anchorDate: eff.anchorDate, balance: eff.balance };
  }
  return { accounts, existing, anchors };
}

export interface FreshnessData {
  currentThrough: string | null;
  showNudge: boolean;
  asOfByAccount: Record<string, string>;
}

/** Freshness of the user's real (non-demo) data: per-account "as of" dates,
 * the household's weakest-link date, and whether the staleness nudge shows.
 * Wall-clock "today" is supplied here — the engine functions stay pure. */
export async function getFreshnessData(supabase: SupabaseClient): Promise<FreshnessData> {
  const [acctRes, anchorRows, txnRows, profRes] = await Promise.all([
    supabase.from("financial_accounts").select("id, provider, include_in_calculations, archived_at"),
    paginateSelect<{ account_id: string; anchor_date: string; balance: number; created_at: string }>(
      TRANSACTIONS_PAGE_SIZE,
      (from, to) =>
        supabase.from("balance_anchors")
          .select("account_id, anchor_date, balance, created_at")
          .order("id", { ascending: true })
          .range(from, to)),
    paginateSelect<{ account_id: string; posted_date: string }>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
      supabase.from("transactions")
        .select("account_id, posted_date")
        .order("id", { ascending: true })
        .range(from, to)),
    supabase.from("user_profiles").select("stale_nudge_dismissed_at").maybeSingle(),
  ]);
  if (acctRes.error) throw acctRes.error;
  if (profRes.error) throw profRes.error;

  const newestTxn = new Map<string, string>();
  for (const t of txnRows) {
    const cur = newestTxn.get(t.account_id);
    if (!cur || t.posted_date > cur) newestTxn.set(t.account_id, t.posted_date);
  }
  const anchorsByAccount = new Map<string, BalanceAnchor[]>();
  for (const r of anchorRows) {
    const list = anchorsByAccount.get(r.account_id) ?? [];
    list.push({ accountId: r.account_id, anchorDate: r.anchor_date, balance: Number(r.balance), createdAt: r.created_at });
    anchorsByAccount.set(r.account_id, list);
  }

  interface FreshAcctRow { id: string; provider: string; include_in_calculations: boolean; archived_at: string | null }
  const inputs: AccountFreshnessInput[] = (acctRes.data as FreshAcctRow[]).map((a) => ({
    id: a.id,
    provider: a.provider,
    includeInCalculations: a.include_in_calculations,
    archived: a.archived_at !== null,
    anchorDate: effectiveAnchor(anchorsByAccount.get(a.id) ?? [])?.anchorDate ?? null,
    newestTxnDate: newestTxn.get(a.id) ?? null,
  }));

  const currentThrough = householdFreshness(inputs);
  const today = new Date().toISOString().slice(0, 10);
  const dismissedOn = profRes.data?.stale_nudge_dismissed_at?.slice(0, 10) ?? null;

  const asOfByAccount: Record<string, string> = {};
  for (const i of inputs) {
    if (i.provider === "demo") continue;
    const f = accountFreshness(i);
    if (f) asOfByAccount[i.id] = f;
  }

  return { currentThrough, showNudge: nudgeVisible(currentThrough, today, dismissedOn), asOfByAccount };
}

/** Derived batch summaries — no import_batches table; grouped client-side. */
export async function getRecentImports(supabase: SupabaseClient): Promise<RecentImport[]> {
  interface RecentImportRow {
    id: string; import_batch_id: string; posted_date: string; created_at: string;
    financial_accounts: { display_name: string };
  }
  const rows = await paginateSelect<RecentImportRow>(TRANSACTIONS_PAGE_SIZE, (from, to) =>
    supabase.from("transactions")
      .select("id, import_batch_id, posted_date, created_at, financial_accounts!inner(display_name)")
      .not("import_batch_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: RecentImportRow[] | null; error: { message: string } | null }>);
  const groups = new Map<string, RecentImport>();
  for (const r of rows) {
    const g = groups.get(r.import_batch_id);
    if (!g) {
      groups.set(r.import_batch_id, {
        batchId: r.import_batch_id,
        accountName: r.financial_accounts.display_name,
        rowCount: 1,
        firstDate: r.posted_date,
        lastDate: r.posted_date,
        importedAt: r.created_at,
      });
    } else {
      g.rowCount++;
      if (r.posted_date < g.firstDate) g.firstDate = r.posted_date;
      if (r.posted_date > g.lastDate) g.lastDate = r.posted_date;
      if (r.created_at > g.importedAt) g.importedAt = r.created_at;
    }
  }
  return [...groups.values()].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
}

export interface RecurringListItem extends RecurringSeries {
  status: "confirmed" | "dismissed" | null;
}

/**
 * Detected recurring series with the user's confirm/dismiss status merged in.
 * Detection is recomputed here, not persisted — the reference date is derived
 * from the data (never wall-clock "today") so demo datasets with a fixed end
 * date don't spuriously read as lapsed.
 */
export async function getRecurringData(supabase: SupabaseClient): Promise<RecurringListItem[]> {
  interface RecurringAccountRow {
    id: string; type: string; current_balance: number | null;
    include_in_calculations: boolean; archived_at: string | null;
  }
  const [acctRes, txnRows, overrideRows, latestSnap] = await Promise.all([
    supabase.from("financial_accounts")
      .select("id, type, current_balance, include_in_calculations, archived_at"),
    paginateSelect<TransactionRow>(1000, (from, to) =>
      supabase.from("transactions")
        .select("id, account_id, posted_date, amount, direction, description, category, essential, is_transfer, transfer_pair_id")
        .order("id", { ascending: true })
        .range(from, to)),
    paginateSelect<{ series_key: string; status: string }>(1000, (from, to) =>
      supabase.from("recurring_overrides")
        .select("series_key, status")
        .order("series_key", { ascending: true })
        .range(from, to)),
    supabase.from("daily_snapshots")
      .select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (acctRes.error) throw acctRes.error;

  const active = (acctRes.data as RecurringAccountRow[]).filter(
    (a) => a.archived_at === null && a.include_in_calculations,
  );
  const activeIds = new Set(active.map((a) => a.id));
  const accounts: AccountInput[] = active.map((a) => ({
    id: a.id,
    type: a.type as AccountType,
    currentBalance: Number(a.current_balance ?? 0),
    includeInCalculations: a.include_in_calculations,
  }));
  const transactions = txnRows.map(rowToTransactionInput).filter((t) => activeIds.has(t.accountId));
  if (transactions.length === 0) return [];

  // Same reference the rebuild derives: the newest known date in the data.
  const maxTxnDate = transactions.reduce((m, t) => (t.postedDate > m ? t.postedDate : m), transactions[0].postedDate);
  const snapDate = (latestSnap.data as { date: string } | null)?.date;
  const referenceDate = snapDate && snapDate > maxTxnDate ? snapDate : maxTxnDate;

  const statusByKey = new Map(overrideRows.map((r) => [r.series_key, r.status as "confirmed" | "dismissed"]));
  return detectRecurringSeries(accounts, transactions, referenceDate)
    .map((s) => ({ ...s, status: statusByKey.get(s.seriesKey) ?? null }))
    .sort((a, b) =>
      a.nextExpectedDate < b.nextExpectedDate ? -1 : a.nextExpectedDate > b.nextExpectedDate ? 1
        : a.seriesKey < b.seriesKey ? -1 : 1);
}

// ---------- Academy (Slice 3) ----------

export interface AcademyProgressResult {
  rows: ProgressRow[];
  /** Non-null when the query failed: render Not-started + a notice, never fake completion. */
  error: string | null;
}

/** All of the user's academy_progress rows. Row count is bounded by the
 *  15-concept registry, so no pagination is needed (DECISIONS #21 audit). */
export async function getAcademyProgress(supabase: SupabaseClient): Promise<AcademyProgressResult> {
  const { data, error } = await supabase
    .from("academy_progress")
    .select("concept_id, started_at, completed_at, check_responses");
  if (error) return { rows: [], error: error.message };
  return {
    rows: (data ?? []).map((r) => ({
      conceptId: r.concept_id as string,
      startedAt: r.started_at as string,
      completedAt: (r.completed_at as string | null) ?? null,
      checkResponses: (r.check_responses as CheckResponse[] | null) ?? [],
    })),
    error: null,
  };
}

/** Completed concept ids for the term-sheet variant. [] when signed out or on error
 *  (the sheet then shows the pre-completion variant — the safe degradation). */
export async function getCompletedConceptIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("academy_progress")
    .select("concept_id")
    .not("completed_at", "is", null);
  if (error) return [];
  return (data ?? []).map((r) => r.concept_id as string);
}
