"use client";

import { useMemo, useState } from "react";
import { Share2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { FinancialChart } from "@/components/chart/FinancialChart";
import {
  buildIndexSeries,
  buildManagementCommentary,
  computePeriodStatement,
  enumeratePeriods,
  latestCompletePeriod,
  formatDollars,
  formatSignedDollars,
  type DailySnapshot,
  type FinancialEvent,
  type ReportGranularity,
} from "@/lib/financial-engine";
import type { TransactionInput } from "@/lib/financial-engine/snapshot-builder";

const GRANULARITIES = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
] as const;

interface ReportViewProps {
  companyName: string;
  ticker: string;
  snapshots: DailySnapshot[];
  transactions: TransactionInput[];
  events: FinancialEvent[];
}

export function ReportView({ companyName, ticker, snapshots, transactions, events }: ReportViewProps) {
  const [granularity, setGranularity] = useState<ReportGranularity>("quarterly");

  const indexPoints = useMemo(() => buildIndexSeries(snapshots).points, [snapshots]);
  const periods = useMemo(() => enumeratePeriods(snapshots, granularity), [snapshots, granularity]);
  const [periodKey, setPeriodKey] = useState<string>(() => latestCompletePeriod(periods)?.key ?? "");

  const selectedPeriod = periods.find((p) => p.key === periodKey) ?? latestCompletePeriod(periods);

  function changeGranularity(next: ReportGranularity) {
    setGranularity(next);
    const nextPeriods = enumeratePeriods(snapshots, next);
    setPeriodKey(latestCompletePeriod(nextPeriods)?.key ?? "");
  }

  if (snapshots.length === 0 || !selectedPeriod) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-primary">Report</h1>
        <Card className="p-8 text-center text-sm text-secondary">
          No financial data yet. Load demo data from the Home tab to generate a report.
        </Card>
      </div>
    );
  }

  const statement = computePeriodStatement(snapshots, transactions, events, indexPoints, selectedPeriod);
  const commentary = buildManagementCommentary(statement, companyName);
  const periodPoints = indexPoints.filter((p) => p.date >= selectedPeriod.start && p.date <= selectedPeriod.end);
  const subtitle = granularity === "quarterly" ? "Quarterly Shareholder Report" : "Monthly Report";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Report</h1>
          <p className="mt-0.5 text-sm text-secondary">{subtitle}</p>
          <p className="tabular mt-1 text-xs text-tertiary">
            {companyName} · {ticker} · {selectedPeriod.label}
          </p>
        </div>
        <span
          title="Coming soon"
          className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-elevated px-3 py-1.5 text-xs text-tertiary"
        >
          <Share2 size={13} aria-hidden />
          Share
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          options={GRANULARITIES.map((g) => ({ key: g.key, label: g.label }))}
          value={granularity}
          onChange={(k) => changeGranularity(k as ReportGranularity)}
          ariaLabel="Report granularity"
        />
        <label className="sr-only" htmlFor="report-period">Period</label>
        <select
          id="report-period"
          value={selectedPeriod.key}
          onChange={(e) => setPeriodKey(e.target.value)}
          className="rounded-full border border-border-subtle bg-inset px-4 py-1.5 text-xs font-medium text-primary focus:border-border-strong focus:outline-none"
        >
          {periods.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
              {p.complete ? "" : " (partial)"}
            </option>
          ))}
        </select>
      </div>

      {periodPoints.length > 1 && (
        <Card className="p-4">
          <FinancialChart
            points={periodPoints}
            markers={[]}
            ariaDescription={`Personal index over ${selectedPeriod.label}: from ${statement.indexStart.toFixed(1)} to ${statement.indexEnd.toFixed(1)}.`}
          />
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 text-base font-semibold text-primary">Statement · {selectedPeriod.label}</h2>
        <dl className="flex flex-col">
          <StatementRow label="Revenue" value={formatDollars(statement.revenue)} tone="positive" />
          <StatementRow label="Operating expenses" value={`− ${formatDollars(statement.operatingExpenses)}`} tone="negative" />
          <StatementRow label="Free cash flow" value={formatSignedDollars(statement.freeCashFlow)} tone={statement.freeCashFlow >= 0 ? "positive" : "negative"} emphasized />
          <p className="mt-3 mb-1 text-xs font-medium text-secondary">Allocated to</p>
          <StatementRow label="Savings (retained cash)" value={formatSignedDollars(statement.savings)} indent />
          <StatementRow label="Investments (contributions)" value={formatDollars(statement.investments)} indent />
          <StatementRow label="Debt reduction" value={formatSignedDollars(statement.debtReduction)} indent />
          <StatementRow label="Owner-created equity" value={formatSignedDollars(statement.ownerCreatedEquity)} tone={statement.ownerCreatedEquity >= 0 ? "positive" : "negative"} emphasized indent />
          <StatementRow label="Market appreciation" value="n/a — no market data yet" muted indent />
          <div className="my-2 border-t border-border-subtle" />
          <StatementRow label="Index movement" value={`${statement.indexChange >= 0 ? "+" : "−"}${Math.abs(statement.indexChange).toFixed(1)} pts`} tone={statement.indexChange >= 0 ? "positive" : "negative"} />
          <StatementRow label="Savings rate" value={`${statement.savingsRatePct.toFixed(1)}%`} />
        </dl>
      </Card>

      <Card className="p-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary">Management commentary</h2>
          <span className="rounded-full bg-neutral-muted px-2.5 py-0.5 text-[11px] font-medium text-secondary">
            Calculated · AI narration in Phase 4
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {commentary.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed text-secondary">{line}</p>
          ))}
        </div>
        <p className="mt-3 text-xs text-tertiary">
          Educational analysis, not financial, tax, or investment advice.
        </p>
      </Card>
    </div>
  );
}

function StatementRow({
  label, value, tone = "neutral", emphasized = false, indent = false, muted = false,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
  emphasized?: boolean;
  indent?: boolean;
  muted?: boolean;
}) {
  const valueColor =
    muted ? "text-tertiary"
    : tone === "positive" ? "text-positive"
    : tone === "negative" ? "text-negative"
    : "text-primary";
  return (
    <div className={`flex items-baseline justify-between py-1.5 ${emphasized ? "font-semibold" : ""} ${indent ? "pl-3" : ""}`}>
      <dt className={`text-sm ${emphasized ? "text-primary" : "text-secondary"}`}>{label}</dt>
      <dd className={`tabular text-sm ${valueColor}`}>{value}</dd>
    </div>
  );
}
