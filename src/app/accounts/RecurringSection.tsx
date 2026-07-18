"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { clearRecurringOverride, setRecurringOverride } from "@/app/actions/recurring";
import { formatDollars } from "@/lib/financial-engine/format";
import type { RecurringListItem } from "@/lib/data/queries";

const chipCls = "rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-tertiary";
const actionCls = "rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60";

const CADENCE_LABEL: Record<RecurringListItem["cadence"], string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks", semimonthly: "Twice a month",
  monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly",
};

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function formatNext(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Row({ item, pending, onConfirm, onDismiss, onClear }: {
  item: RecurringListItem;
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onClear: () => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <li data-testid="recurring-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-primary">{titleCase(item.displayName)}</p>
        <p className="text-xs text-tertiary">
          {CADENCE_LABEL[item.cadence]} · {item.variableAmount ? "~" : ""}{formatDollars(item.typicalAmount)}
          {item.lapsed ? " · last seen " + formatNext(item.lastDate) : " · next " + formatNext(item.nextExpectedDate)}
        </p>
      </div>
      <span className={chipCls} aria-label={`${item.confidence} confidence, based on ${item.occurrenceCount} occurrences`}>
        {item.confidence === "high" ? "◆◆◆" : item.confidence === "medium" ? "◆◆◇" : "◆◇◇"} {item.confidence}
      </span>
      {item.lapsed && <span className={chipCls}>Lapsed</span>}
      {item.isDebtPayment && <span className={chipCls}>Debt payment</span>}
      <div className="flex items-center gap-1.5">
        {item.status === "confirmed" ? (
          <>
            <span className={chipCls}>✓ Confirmed</span>
            <button type="button" className={actionCls} disabled={pending} onClick={onClear}>Undo</button>
          </>
        ) : armed ? (
          <>
            <button type="button" className={actionCls} disabled={pending}
              onClick={() => { setArmed(false); onDismiss(); }}>
              Confirm dismiss
            </button>
            <button type="button" className={actionCls} disabled={pending} onClick={() => setArmed(false)}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" className={actionCls} disabled={pending} onClick={onConfirm}>Confirm</button>
            <button type="button" className={actionCls} disabled={pending} onClick={() => setArmed(true)}>Dismiss</button>
          </>
        )}
      </div>
    </li>
  );
}

export function RecurringSection({ items }: { items: RecurringListItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const mutate = (fn: () => Promise<{ error: string; warning?: string }>) => {
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setNotice(`✕ ${result.error}`);
      else if (result.warning) setNotice(`⚠ ${result.warning}`);
      router.refresh();
    });
  };

  const dismissed = items.filter((i) => i.status === "dismissed");
  const visible = items.filter((i) => i.status !== "dismissed");
  const income = visible.filter((i) => i.isIncome);
  const bills = visible.filter((i) => !i.isIncome);

  const renderRow = (i: RecurringListItem) => (
    <Row key={i.seriesKey} item={i} pending={pending}
      onConfirm={() => mutate(() => setRecurringOverride(i.seriesKey, "confirmed"))}
      onDismiss={() => mutate(() => setRecurringOverride(i.seriesKey, "dismissed"))}
      onClear={() => mutate(() => clearRecurringOverride(i.seriesKey))} />
  );

  return (
    <section id="recurring" aria-labelledby="recurring-heading">
      <Card>
        <div className="flex items-baseline justify-between">
          <h2 id="recurring-heading" className="text-base font-semibold text-primary">Recurring</h2>
          <span className="text-xs text-tertiary">{visible.length} detected</span>
        </div>
        <p className="mt-1 text-xs text-secondary">
          Repeating income and bills detected from your transaction history. Beyond your known
          history, obligations on the dashboard are projected from the items below — dismiss
          anything that shouldn&apos;t count.
        </p>

        {notice && <p role="status" className="mt-2 text-xs text-warning">{notice}</p>}

        {items.length === 0 ? (
          <p className="mt-3 text-sm text-secondary">
            Nothing recurring detected yet. Detection needs about three occurrences of a similar
            transaction — <a href="/import" className="underline">import more history</a> to improve it.
          </p>
        ) : (
          <>
            {income.length > 0 && (
              <>
                <h3 className="mt-3 text-xs font-medium uppercase tracking-wide text-tertiary">Income</h3>
                <ul>{income.map(renderRow)}</ul>
              </>
            )}
            {bills.length > 0 && (
              <>
                <h3 className="mt-3 text-xs font-medium uppercase tracking-wide text-tertiary">Bills &amp; payments</h3>
                <ul>{bills.map(renderRow)}</ul>
              </>
            )}
          </>
        )}

        {dismissed.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-tertiary">Dismissed ({dismissed.length})</summary>
            <ul>{dismissed.map((i) => (
              <li key={i.seriesKey} data-testid="recurring-dismissed-row" className="flex items-center gap-3 border-b border-border-subtle py-2 last:border-b-0">
                <p className="min-w-0 flex-1 truncate text-sm text-tertiary">{titleCase(i.displayName)}</p>
                <button type="button" className={actionCls} disabled={pending}
                  onClick={() => mutate(() => clearRecurringOverride(i.seriesKey))}>
                  Restore
                </button>
              </li>
            ))}</ul>
          </details>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-tertiary">How is this calculated?</summary>
          <div className="mt-2 space-y-2 text-xs text-secondary">
            <p>
              Transactions on cash accounts are grouped by cleaned-up description. A group becomes a
              recurring item when it has at least three occurrences at a steady rhythm (weekly,
              every 2 weeks, twice a month, monthly, quarterly, or yearly) and consistent amounts.
              The typical amount is the median; a ~ marks items whose amounts vary.
            </p>
            <p>
              Confidence reflects how many occurrences support the item and how steady they are —
              more history raises it. Items that stop appearing are marked Lapsed and no longer
              project forward.
            </p>
            <p>
              The dashboard&apos;s Obligations figure sums real upcoming transactions where your history
              covers the window, and projects these recurring items where it doesn&apos;t. Dismissing an
              item removes it from that projection; confirming keeps it projecting even at low
              confidence. Deterministic code computes all of this — nothing here is estimated by AI.
            </p>
          </div>
        </details>
      </Card>
    </section>
  );
}
