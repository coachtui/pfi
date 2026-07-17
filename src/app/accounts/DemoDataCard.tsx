"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Database } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { loadDemoData, clearDemoData } from "@/app/actions/demo";
import { DEMO_PROFILE_METAS, detectActiveProfile } from "@/lib/demo-data/profiles";
import type { AccountSummary } from "@/lib/data/mappers";

export function DemoDataCard({ accounts }: { accounts: AccountSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const demoNames = accounts
    .filter((a) => a.provider === "demo" && !a.archivedAt)
    .map((a) => a.displayName);
  const activeId = detectActiveProfile(demoNames);
  const hasDemo = demoNames.length > 0;

  const run = (fn: () => Promise<{ error: string }>) => {
    setError(null);
    setConfirmingClear(false);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Database size={16} aria-hidden className="text-secondary" />
        <h2 className="text-sm font-semibold text-primary">Demo data</h2>
      </div>
      <p className="text-xs text-secondary">
        {hasDemo
          ? "A fictional sample dataset is loaded alongside any accounts you add yourself. Switching replaces only the demo data — your own accounts and imports are untouched."
          : "No demo data loaded. Load a fictional sample profile to explore the app."}
      </p>
      <ul className="flex flex-col gap-2">
        {DEMO_PROFILE_METAS.map((m) => {
          const active = m.id === activeId;
          return (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle p-2.5"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  {m.companyName} <span className="text-tertiary">{m.ticker}</span>
                  {active && (
                    <span className="flex items-center gap-0.5 rounded-full bg-neutral-muted px-1.5 py-0.5 text-[10px] text-secondary">
                      <Check size={10} aria-hidden /> Active
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-secondary">{m.description}</p>
              </div>
              {!active && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => loadDemoData(m.id))}
                  className="shrink-0 rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60"
                >
                  {hasDemo ? "Switch" : "Load"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hasDemo && (
        <div className="flex items-center gap-2">
          {confirmingClear ? (
            <>
              <span className="text-xs text-secondary">Remove all demo data? Your own accounts stay.</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(clearDemoData)}
                className="rounded-lg border border-negative px-2.5 py-1 text-xs font-medium text-negative disabled:opacity-60"
              >
                Yes, clear it
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmingClear(false)}
                className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary disabled:opacity-60"
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmingClear(true)}
              className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60"
            >
              Clear demo data
            </button>
          )}
        </div>
      )}
      {pending && (
        <p className="text-xs text-secondary" aria-live="polite">
          Updating demo data…
        </p>
      )}
      {error && (
        <p className="text-xs text-negative" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
