"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { setAccountArchived, setAccountIncluded } from "@/app/actions/accounts";
import { formatDollars } from "@/lib/financial-engine/format";
import type { AccountType } from "@/lib/financial-engine";
import type { AccountSummary, RecentImport } from "@/lib/data/mappers";
import type { RecurringListItem } from "@/lib/data/queries";
import { AccountSheet } from "./AccountSheet";
import { DemoDataCard } from "./DemoDataCard";
import { RecentImports } from "./RecentImports";
import { RecurringSection } from "./RecurringSection";

const GROUPS: ReadonlyArray<{ title: string; types: readonly AccountType[] }> = [
  { title: "Cash", types: ["checking", "savings", "money_market"] },
  { title: "Credit", types: ["credit_card"] },
  { title: "Loans", types: ["mortgage", "auto_loan", "student_loan", "personal_loan", "other_liability"] },
  { title: "Investments", types: ["brokerage", "retirement"] },
  { title: "Property & other", types: ["property", "other_asset"] },
];

const chipCls =
  "rounded-full border border-border-subtle px-1.5 py-0.5 text-[10px] text-tertiary";
const actionCls =
  "rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60";

export function AccountsView({
  accounts, recentImports, recurring,
}: {
  accounts: AccountSummary[];
  recentImports: RecentImport[];
  recurring: RecurringListItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AccountSummary | null>(null);
  const [adding, setAdding] = useState(false);
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

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="Back to dashboard" className="rounded-lg p-1 text-secondary hover:text-primary">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg font-semibold text-primary">Accounts</h1>
        </div>
        <Link
          href="/import"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-secondary transition-colors hover:text-primary"
        >
          <Upload size={14} aria-hidden /> Import CSV
        </Link>
      </div>

      {notice && <p role="status" className="text-sm text-warning">{notice}</p>}

      {accounts.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-primary">No accounts yet</p>
          <p className="max-w-sm text-sm text-secondary">
            Add your first account to start tracking your real finances, or load demo data from the dashboard.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-xl bg-positive-strong px-4 py-2 text-sm font-semibold text-base"
          >
            Add account
          </button>
        </Card>
      ) : (
        GROUPS.map(({ title, types }) => {
          const group = accounts.filter((a) => (types as readonly string[]).includes(a.type));
          if (group.length === 0) return null;
          return (
            <section key={title} aria-label={title}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-tertiary uppercase">{title}</h2>
              <div className="flex flex-col gap-3">
                {group.map((a) => {
                  const archived = a.archivedAt !== null;
                  const excluded = !a.includeInCalculations;
                  return (
                    <Card key={a.id} className={`flex flex-col gap-2 p-4 ${archived ? "opacity-70" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/transactions?account=${a.id}`}
                            className="block truncate text-sm font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {a.displayName}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-tertiary">
                            {[a.institution, a.mask ? `··${a.mask}` : null].filter(Boolean).join(" · ") || "Manual account"}
                          </p>
                        </div>
                        <p className="tabular shrink-0 text-sm font-semibold text-primary">
                          {a.currentBalance === null ? "—" : formatDollars(a.currentBalance)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={chipCls}>{a.provider}</span>
                        {excluded && <span className={chipCls}>Excluded</span>}
                        {archived && <span className={chipCls}>Archived</span>}
                      </div>
                      {(excluded || archived) && (
                        <p className="text-xs text-tertiary">
                          {archived
                            ? "Archived accounts and their transactions don’t affect your index. Unarchive to bring them back."
                            : "Excluded accounts don’t affect your index — their history is kept."}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {a.provider === "manual" && !archived && (
                          <button type="button" disabled={pending} onClick={() => setEditing(a)} className={actionCls}>
                            Edit
                          </button>
                        )}
                        {!archived && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => mutate(() => setAccountIncluded(a.id, excluded))}
                            className={actionCls}
                          >
                            {excluded ? "Include in index" : "Exclude from index"}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => mutate(() => setAccountArchived(a.id, !archived))}
                          className={actionCls}
                        >
                          {archived ? "Unarchive" : "Archive"}
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {accounts.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="fixed right-4 bottom-20 z-10 flex items-center gap-2 rounded-full bg-positive-strong px-5 py-3 text-sm font-semibold text-base shadow-card"
        >
          <Plus size={18} aria-hidden /> Add account
        </button>
      )}

      <DemoDataCard accounts={accounts} />

      <RecentImports imports={recentImports} />

      <RecurringSection items={recurring} />

      <AccountSheet account={null} open={adding} onClose={() => setAdding(false)} />
      {editing && <AccountSheet key={editing.id} account={editing} open onClose={() => setEditing(null)} />}
    </div>
  );
}
