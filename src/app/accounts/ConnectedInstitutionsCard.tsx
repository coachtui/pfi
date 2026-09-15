"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleX, Clock, FlaskConical, Hourglass, Landmark, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { InlineError } from "@/components/ui/InlineError";
import { deleteItemData, disconnectItem, syncItem, type SyncResult } from "@/app/actions/plaid";
import type { ConnectedItemSummary } from "@/lib/data/mappers";
import { ConnectDisclosureSheet } from "./ConnectDisclosureSheet";
import { hasSeenDisclosure, markDisclosureSeen, takeLinkResult, type LinkMode, type LinkResult } from "./link-session";
import { summarizeSync, usePfiPlaidLink } from "./usePfiPlaidLink";

/** What the card needs from the server-side Plaid config (never the keys). */
export interface PlaidUiConfig {
  maxItems: number;
  environment: "sandbox" | "production";
}

const actionCls =
  "rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:opacity-60";
const dangerCls =
  "rounded-lg border border-negative px-2.5 py-1 text-xs font-semibold text-negative transition-colors disabled:opacity-60";

/** Status → glyph + text. Never color alone (project accessibility rule). */
const STATUS: Record<ConnectedItemSummary["status"], { label: string; Icon: typeof Check }> = {
  initializing: { label: "Preparing history", Icon: Hourglass },
  history_loading: { label: "Preparing history", Icon: Hourglass },
  connected: { label: "Connected", Icon: Check },
  login_required: { label: "Needs reconnect", Icon: TriangleAlert },
  error: { label: "Error", Icon: CircleX },
  disconnect_pending: { label: "Disconnect pending", Icon: Clock },
  disconnected: { label: "Disconnected", Icon: CircleX },
};

export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ConnectedInstitutionsCard({
  items,
  plaid,
  hasDemo,
}: {
  items: ConnectedItemSummary[];
  /** Null when bank connections are not configured in this environment. */
  plaid: PlaidUiConfig | null;
  hasDemo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ itemId: string; deleteData: boolean } | null>(null);
  const [disclosure, setDisclosure] = useState<{ open: boolean; next: LinkMode | null }>({ open: false, next: null });
  const autoSynced = useRef(false);
  const [autoSyncing, setAutoSyncing] = useState(false);

  const showResult = (r: LinkResult) => {
    if (!r.ok) { setError(r.message); return; }
    setNotice(r.warning ? `⚠ ${r.message}` : r.message);
    router.refresh();
  };

  const link = usePfiPlaidLink({ onResult: showResult });

  // A result handed back from the OAuth return page (spec §1a): a one-time
  // read of a client-only API (sessionStorage) that cannot be computed during
  // render — not the derived-state anti-pattern the lint rule targets.
  useEffect(() => {
    const r = takeLinkResult(window.sessionStorage);
    if (!r) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!r.ok) setError(r.message);
    else { setNotice(r.warning ? `⚠ ${r.message}` : r.message); router.refresh(); }
  }, [router]);

  const run = (label: string, fn: () => Promise<{ error: string; warning?: string }>, onOk?: (r: { error: string; warning?: string }) => string | null) => {
    setError(null);
    setNotice(null);
    setBusy(label);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      setConfirming(null);
      if (res.error && (res as { throttled?: boolean }).throttled) setNotice(res.error);
      else if (res.error) setError(res.error);
      else {
        const msg = onOk ? onOk(res) : null;
        if (res.warning) setNotice(`⚠ ${res.warning}`);
        else if (msg) setNotice(msg);
        router.refresh();
      }
    });
  };

  // Preparing-history Items re-sync once per visit (server throttle: 1 minute in that state).
  useEffect(() => {
    if (autoSynced.current) return;
    const loading = items.filter((i) => i.status === "initializing" || i.status === "history_loading");
    if (loading.length === 0) return;
    autoSynced.current = true;
    startTransition(async () => {
      setAutoSyncing(true);
      let changed = false;
      for (const i of loading) {
        setBusy(i.id);
        const r = await syncItem(i.id);
        if (!r.error && !r.throttled) changed = true;
      }
      setBusy(null);
      setAutoSyncing(false);
      if (changed) router.refresh();
    });
  }, [items, router]);

  const startLink = (mode: LinkMode) => {
    setError(null);
    setNotice(null);
    if (mode.kind === "connect" && !hasSeenDisclosure(window.localStorage)) {
      setDisclosure({ open: true, next: mode });
      return;
    }
    link.startLink(mode);
  };

  const continueFromDisclosure = () => {
    markDisclosureSeen(window.localStorage);
    const next = disclosure.next;
    setDisclosure({ open: false, next: null });
    if (next) link.startLink(next);
  };

  const visible = items.filter((i) => i.status !== "disconnected" || i.accountCount > 0);
  const activeCount = items.filter((i) => i.status !== "disconnected").length;
  const atCap = plaid !== null && activeCount >= plaid.maxItems;
  const linkBusy = link.busy;
  const anyPending = pending || link.pending;
  const itemBusy = (id: string) => busy === id || (typeof linkBusy === "object" && linkBusy !== null && linkBusy.itemId === id);
  const connectLabel = linkBusy === "link" ? "Opening Plaid…" : linkBusy === "connect" ? "Connecting…" : "Connect a bank";

  return (
    <section aria-label="Connected institutions" data-testid="connected-institutions">
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Landmark size={16} aria-hidden className="text-secondary" />
        <h2 className="text-sm font-semibold text-primary">Connected institutions</h2>
        {plaid?.environment === "sandbox" && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-warning px-2 py-0.5 text-[11px] font-medium text-warning"
            title="Plaid Sandbox: test banks only, no real accounts"
          >
            <FlaskConical size={11} aria-hidden /> Sandbox
          </span>
        )}
      </div>

      {plaid === null ? (
        <p className="text-xs text-secondary">
          Bank connections are not configured in this environment. Add accounts manually or import statements instead.
        </p>
      ) : (
        <>
          <p className="text-xs text-secondary">
            Connect a bank through Plaid to keep transactions and balances synced. Balances show as of the last sync with Plaid.
            Manual accounts — cash on hand, property, anything a bank doesn&apos;t see — stay exactly as they are.
          </p>
          <p className="text-[11px] text-tertiary" data-testid="connection-count">
            {activeCount} of {plaid.maxItems} connection{plaid.maxItems === 1 ? "" : "s"} used
          </p>
          {autoSyncing && (
            <p role="status" className="flex items-center gap-1 text-xs text-secondary">
              <Hourglass size={12} aria-hidden /> Checking with Plaid for new history…
            </p>
          )}
          {hasDemo && visible.length === 0 && (
            <p role="status" className="text-xs text-warning">
              Demo data is loaded. Clear it first (Demo data card below) so your dashboard shows only your own accounts.
            </p>
          )}
          <InlineError message={error ?? ""} />
          {notice && <p role="status" className="text-xs text-secondary">{notice}</p>}

          {visible.length > 0 && (
            <ul className="flex flex-col gap-2">
              {visible.map((item) => {
                const { label, Icon } = STATUS[item.status];
                const isBusy = itemBusy(item.id);
                const loading = item.status === "initializing" || item.status === "history_loading";
                return (
                  <li key={item.id} className="flex flex-col gap-2 rounded-lg border border-border-subtle p-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-primary">{item.institutionName ?? "Institution"}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-secondary">
                          <Icon size={12} aria-hidden /> {label}
                          {item.status === "error" && item.errorCode ? ` (${item.errorCode})` : ""}
                          {" · "}{item.accountCount} account{item.accountCount === 1 ? "" : "s"}
                        </p>
                        <p className="text-[11px] text-tertiary" suppressHydrationWarning>
                          Last synced with Plaid {relativeTime(item.lastSyncedAt)}
                        </p>
                        {loading && (
                          <p className="mt-1 text-[11px] text-secondary">
                            Connected. Plaid is preparing your transaction history. Check again shortly.
                          </p>
                        )}
                        {item.stillBillable && (
                          <p className="mt-1 text-[11px] text-warning">
                            Still billable — reconnect or disconnect this institution.
                          </p>
                        )}
                        {item.status === "disconnect_pending" && (
                          <p className="mt-1 text-[11px] text-warning">
                            Plaid didn&apos;t confirm the disconnect. Retry so this connection stops being billed.
                          </p>
                        )}
                        {item.status === "disconnected" && (
                          <p className="mt-1 text-[11px] text-tertiary">Disconnected — history kept.</p>
                        )}
                      </div>
                    </div>

                    {confirming?.itemId === item.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={anyPending}
                          onClick={() => run(item.id, () => (confirming.deleteData ? deleteItemData(item.id) : disconnectItem(item.id)), () =>
                            confirming.deleteData ? "Disconnected and deleted this institution's data." : "Disconnected — history kept.")}
                          className={dangerCls}
                        >
                          {isBusy ? "Working…" : confirming.deleteData ? "Confirm — delete its data" : "Confirm disconnect"}
                        </button>
                        <button type="button" disabled={anyPending} onClick={() => setConfirming(null)} className={actionCls}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {item.status !== "disconnected" && item.status !== "disconnect_pending" && (
                          <button
                            type="button"
                            disabled={anyPending}
                            onClick={() => run(item.id, () => syncItem(item.id), (r) => summarizeSync(r as SyncResult))}
                            className={actionCls}
                          >
                            {isBusy ? "Syncing…" : "Sync now"}
                          </button>
                        )}
                        {(item.status === "login_required" || item.status === "error") && (
                          <button type="button" disabled={anyPending} onClick={() => startLink({ kind: "update", itemId: item.id })} className={actionCls}>
                            Reconnect
                          </button>
                        )}
                        {item.status !== "disconnected" && (
                          <button type="button" disabled={anyPending} onClick={() => setConfirming({ itemId: item.id, deleteData: false })} className={actionCls}>
                            {item.status === "disconnect_pending" ? "Retry disconnect" : "Disconnect"}
                          </button>
                        )}
                        <button type="button" disabled={anyPending} onClick={() => setConfirming({ itemId: item.id, deleteData: true })} className={actionCls}>
                          {item.status === "disconnected" ? "Delete its data" : "Disconnect and delete data"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-1">
            <button
              type="button"
              disabled={anyPending || linkBusy !== null || atCap}
              onClick={() => startLink({ kind: "connect" })}
              className="self-start rounded-xl bg-positive-strong px-4 py-2 text-sm font-semibold text-base disabled:opacity-60"
            >
              {connectLabel}
            </button>
            {atCap && (
              <p className="text-[11px] text-secondary">
                Limit of {plaid.maxItems} connected institution{plaid.maxItems === 1 ? "" : "s"} reached — disconnect one to connect another.
              </p>
            )}
          </div>
        </>
      )}
    </Card>
    <ConnectDisclosureSheet
      open={disclosure.open}
      onClose={() => setDisclosure({ open: false, next: null })}
      onContinue={continueFromDisclosure}
    />
    </section>
  );
}
