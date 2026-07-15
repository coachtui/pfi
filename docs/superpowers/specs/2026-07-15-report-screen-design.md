# Report Screen — Design Spec

Date: 2026-07-15 · Status: approved (user) · Slice: Phase 1 report screen (next priority in CURRENT_PHASE)

## Goal

Build the Report screen: a monthly/quarterly shareholder-style financial statement computed deterministically from the user's demo data via the financial engine, with a period chart and a management-commentary block. It should feel like reviewing the performance of a personal company for a period.

## Non-goals

Real AI narration (commentary is a deterministic template, tagged for Phase 4). Real market appreciation (no holdings data yet — Phase 7). Real PDF/share export (placeholder button only). Manual data / CSV (Phase 3). No new DB tables, no schema changes.

## Decisions (from brainstorm)

1. **Periods:** Monthly + Quarterly toggle with a period picker; default to the most recent *complete* period.
2. **Chart:** a compact index line for the selected window (reuse existing chart styling).
3. **Commentary:** deterministic template assembled from the period's computed numbers, in shareholder-letter tone, tagged "Calculated · AI narration in Phase 4". No fabrication.
4. **Owner-created equity:** shown with a market-appreciation line rendered as $0 / "n/a — no market data yet".
5. **Share/Download:** placeholder button, `title="Coming soon"`, no action, no `cursor-pointer`.
6. **Computation location:** client-side in `ReportView` from raw snapshots+events fetched once by the page (instant period switching, mirrors Home's range toggle).

## The statement (reconciling waterfall)

**Operating expenses is defined as all non-transfer spending** (cash essentials *and* card discretionary, regardless of how financed). This makes the statement reconcile exactly:

```
Revenue (income)                 +$X     income inflows (paychecks + bonuses): non-transfer inflow, category "income"
Operating expenses               −$Y     all non-transfer outflows, any account
──────────────────────────────
Free cash flow                   =$Z     = revenue − operating expenses

Allocated to
  Savings (retained cash)          $a    Δ liquid assets (end − start snapshot)
  Investments (contributions)      $b    investment-contribution outflow transactions in period
  Debt reduction                   $c    Δ revolving balance paid down (start − end snapshot)
  ────────────────────────
  Owner-created equity             $Z    = a + b + c
  Market appreciation              $0    "n/a — no market data yet"

Index movement                  +N.N pts index(end) − index(start) over the period
Savings rate                      P%      savings / revenue (guard divide-by-zero)
```

**Identity:** `FCF = savings + investments + debtReduction = ownerCreatedEquity` holds exactly for the demo because market drift is zero and mortgage/property balances are static. Proof: with total spending = cash opex + card spend, `income − total spending = (retained cash) + (contributions) + (net debt reduction)` — the card-financed spend and CC payment cancel. When real investment data arrives, market appreciation becomes a real line added on top to reach total net-worth change; the waterfall structure is unchanged.

Every figure traces to transactions or snapshot deltas. Nothing is invented.

## Architecture

### Engine — `src/lib/financial-engine/report.ts` (framework-free, tested)

```ts
export type ReportGranularity = "monthly" | "quarterly";
export interface ReportPeriod { key: string; label: string; start: ISODate; end: ISODate; complete: boolean; }
export function enumeratePeriods(snapshots: DailySnapshot[], granularity: ReportGranularity): ReportPeriod[];

export interface PeriodStatement {
  period: ReportPeriod;
  revenue: number;
  operatingExpenses: number;   // positive magnitude
  freeCashFlow: number;
  savings: number;             // Δ liquid
  investments: number;         // contributions
  debtReduction: number;       // Δ revolving paid down (signed: + = reduced)
  ownerCreatedEquity: number;  // savings + investments + debtReduction
  marketAppreciation: number;  // 0 in this phase
  indexStart: number;
  indexEnd: number;
  indexChange: number;
  savingsRatePct: number;      // savings / revenue * 100, 0 when revenue <= 0
}
export function computePeriodStatement(
  snapshots: DailySnapshot[],
  transactions: TransactionInput[],   // demo/real transaction shape from snapshot-builder
  indexPoints: IndexPoint[],
  period: { start: ISODate; end: ISODate },
): PeriodStatement;

export function buildManagementCommentary(statement: PeriodStatement, companyName: string): string[];
```

- `enumeratePeriods`: buckets the snapshot date range into months or quarters; each period `complete` iff its full span is within the data range (the trailing partial period is `complete: false`). Labels: "June 2026" / "Q2 2026".
- `computePeriodStatement`: filters transactions to `[start, end]`, reads the snapshots at (or nearest on/after `start`, and at/nearest on/before `end`) period bounds for deltas, reads index at the same bounds. Returns zeroes (no NaN) for an empty period.
- `buildManagementCommentary`: 3–5 sentences assembled from the statement figures only; shareholder-letter tone; tested to include the actual numbers and to avoid any figure not present in the statement.

Transactions must be available to the client. `getDashboardData` currently returns snapshots + events, not transactions. **Add a query** `getReportData(supabase)` (or extend the page's fetch) returning `{ snapshots, transactions, events }` — transactions mapped to the engine's `TransactionInput` shape via a new `rowToTransactionInput` mapper. RLS-scoped like all queries; server-only.

### Screen

- `src/app/report/page.tsx` (server): auth + onboarding guards (same pattern as `/rankings`, `/data`); fetch snapshots + transactions + events; pass to `ReportView`. Redirect to `/onboarding` when profile/company absent; render an empty state (reuse `EmptyDashboard` pattern or a small inline empty card) when there are no snapshots.
- `src/app/report/ReportView.tsx` (client): holds `granularity` + `period` state; computes `enumeratePeriods` and the selected `PeriodStatement` on each change. Sections:
  - **Header:** "Report", subtitle "Quarterly Shareholder Report" / "Monthly Report", company identity + ticker, placeholder **Share** button (`title="Coming soon"`, no cursor-pointer/onClick).
  - **Controls:** shared `Segmented` (Monthly | Quarterly) + period `<select>` (labels from `enumeratePeriods`, default latest complete).
  - **Period chart:** compact index line for the selected window (slice `indexPoints` to the period; reuse `FinancialChart` or a trimmed period variant). Index values are anchored on full history, not re-based to the period — consistent with Home; do not re-anchor.
  - **Statement card:** the waterfall rows grouped (Revenue / Operating expenses / **Free cash flow** emphasized / "Allocated to": Savings, Investments, Debt reduction, **Owner-created equity**, Market appreciation "n/a — no market data yet" / Index movement / Savings rate). Sign-driven tones; never color alone (signed values + labels carry meaning).
  - **Commentary card:** `buildManagementCommentary` sentences, tagged "Calculated · AI narration in Phase 4", plus the educational-not-advice disclaimer line used elsewhere.

Mobile-first at 390px; tokens only; reuse `Card`, `Segmented`, `FinancialChart`, existing formatters (`formatDollars`, `formatSignedDollars`, `formatSignedPercent`).

## Testing & verification

- Engine unit tests (`report.test.ts`): hand-computed fixture period asserting every line and the exact `FCF = savings + investments + debtReduction = ownerCreatedEquity` identity; `enumeratePeriods` bucketing + latest-complete default + partial-period `complete:false`; empty period returns zeroes without NaN; `buildManagementCommentary` includes real figures and invents none. New mapper `rowToTransactionInput` round-trip test if added.
- `pnpm check` green.
- Browser verification at 390×844 and 1280×900 (signed-in session): open `/report`, toggle Monthly↔Quarterly, switch periods, confirm the statement reconciles visibly, the period chart renders, commentary reads sensibly, console clean. Screenshot for the record.

## Risks

- Period chart not re-anchored to the window → short periods may not start near 100. Accepted (consistent with Home).
- Snapshot-at-bound selection must handle a `start` that predates the first snapshot (clamp to first) and an `end` beyond the last (clamp to last) — covered by tests.
- Adding transactions to the client payload increases page weight; the demo set is ~430 days of transactions but still small — acceptable, revisit if real data volumes grow (note in KNOWN_LIMITATIONS if needed).
