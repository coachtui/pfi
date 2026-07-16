"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { formatShortDate, formatSignedDollars } from "@/lib/financial-engine/format";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/config/categories";
import type { AccountSummary, TransactionListItem } from "@/lib/data/mappers";
import type { TransactionFilters } from "@/lib/validation/transactions";
import { AddTransactionSheet, TransactionDetailSheet } from "./TransactionSheet";

const selectCls =
  "rounded-full border border-border-subtle bg-inset px-3 py-1.5 text-xs text-primary focus:border-border-strong focus:outline-none";

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function TransactionsView({
  transactions,
  accounts,
  filters,
  contextLabel,
}: {
  transactions: TransactionListItem[];
  accounts: AccountSummary[];
  filters: TransactionFilters;
  contextLabel: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState<TransactionListItem | null>(null);
  const [adding, setAdding] = useState(false);

  const hasFilters = Boolean(
    filters.account || filters.category || filters.direction || filters.from || filters.to,
  );
  const pickerAccounts = accounts.filter((a) => a.archivedAt === null);
  const manualAccounts = pickerAccounts.filter((a) => a.provider === "manual");

  const setFilter = (patch: Partial<Record<keyof TransactionFilters | "label", string | undefined>>) => {
    const next = new URLSearchParams();
    const merged = { ...filters, label: contextLabel ?? undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const groups = useMemo(() => {
    const map = new Map<string, TransactionListItem[]>();
    for (const t of transactions) {
      const key = t.postedDate.slice(0, 7);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [transactions]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Back to dashboard" className="rounded-lg p-1 text-secondary hover:text-primary">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-semibold text-primary">Transactions</h1>
      </div>

      {contextLabel && (filters.from || filters.to) && (
        <Card className="flex items-center justify-between gap-3 p-3">
          <p className="text-sm text-secondary">
            Showing {filters.from === filters.to ? formatShortDate(filters.from!) : "a date range"} — tapped from{" "}
            <span className="font-medium text-primary">{contextLabel}</span>
          </p>
          <button
            type="button"
            onClick={() => setFilter({ from: undefined, to: undefined, label: undefined })}
            className="shrink-0 text-xs font-medium text-secondary underline hover:text-primary"
          >
            Clear filters
          </button>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <select
          aria-label="Filter by account"
          className={selectCls}
          value={filters.account ?? ""}
          onChange={(e) => setFilter({ account: e.target.value || undefined })}
        >
          <option value="">All accounts</option>
          {pickerAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
        <select
          aria-label="Filter by category"
          className={selectCls}
          value={filters.category ?? ""}
          onChange={(e) => setFilter({ category: (e.target.value || undefined) as Category | undefined })}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <Segmented
          ariaLabel="Filter by direction"
          options={[{ key: "all", label: "All" }, { key: "inflow", label: "In" }, { key: "outflow", label: "Out" }]}
          value={filters.direction ?? "all"}
          onChange={(key) => setFilter({ direction: key === "all" ? undefined : key })}
        />
        {hasFilters && (
          <button
            type="button"
            onClick={() => router.replace(pathname)}
            className="text-xs font-medium text-secondary underline hover:text-primary"
          >
            Clear all
          </button>
        )}
      </div>

      {transactions.length === 0 ? (
        hasFilters ? (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm font-medium text-primary">No transactions match these filters</p>
            <button
              type="button"
              onClick={() => router.replace(pathname)}
              className="rounded-xl border border-border-subtle px-4 py-2 text-sm text-secondary hover:text-primary"
            >
              Clear filters
            </button>
          </Card>
        ) : (
          <Card className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-sm font-medium text-primary">No transactions yet</p>
            <p className="max-w-sm text-sm text-secondary">
              Add a transaction to a manual account, or load demo data from the dashboard to explore.
            </p>
            {manualAccounts.length > 0 && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="rounded-xl bg-positive-strong px-4 py-2 text-sm font-semibold text-base"
              >
                Add transaction
              </button>
            )}
          </Card>
        )
      ) : (
        <div className="flex flex-col gap-5 pb-24">
          {groups.map(([month, items]) => (
            <section key={month} aria-label={monthLabel(month)}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">
                {monthLabel(month)}
              </h2>
              <Card className="divide-y divide-border-subtle">
                {items.map((t) => {
                  const inflow = t.direction === "inflow";
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelected(t)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-inset"
                    >
                      <span
                        aria-hidden
                        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                          inflow ? "bg-positive-muted text-positive" : "bg-inset text-secondary"
                        }`}
                      >
                        {inflow ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-primary">
                          {t.description}
                          {t.corrected && (
                            <span className="ml-2 rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-tertiary">
                              corrected
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-tertiary">
                          {t.accountName} · {formatShortDate(t.postedDate)}
                          {t.category ? ` · ${CATEGORY_LABELS[t.category as Category] ?? t.category}` : ""}
                        </span>
                      </span>
                      <span
                        className={`tabular shrink-0 text-sm font-semibold ${
                          inflow ? "text-positive" : "text-primary"
                        }`}
                      >
                        {formatSignedDollars(inflow ? t.amount : -t.amount)}
                      </span>
                    </button>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}

      {manualAccounts.length > 0 && transactions.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="fixed right-4 bottom-20 z-10 flex items-center gap-2 rounded-full bg-positive-strong px-5 py-3 text-sm font-semibold text-base shadow-card"
        >
          <Plus size={18} aria-hidden /> Add transaction
        </button>
      )}
      <AddTransactionSheet accounts={manualAccounts} open={adding} onClose={() => setAdding(false)} />
      {selected && (
        <TransactionDetailSheet
          key={selected.id}
          txn={selected}
          open
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
