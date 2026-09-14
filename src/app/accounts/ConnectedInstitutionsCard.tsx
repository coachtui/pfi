"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { Check, CircleX, Clock, Hourglass, Landmark, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { InlineError } from "@/components/ui/InlineError";
import {
  createLinkToken, createUpdateLinkToken, deleteItemData, disconnectItem, exchangePublicToken, syncItem,
  type SyncResult,
} from "@/app/actions/plaid";
import type { ConnectedItemSummary } from "@/lib/data/mappers";

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

function summarize(r: SyncResult): string {
  const c = r.counts;
  if (!c) return "Synced.";
  const parts = [`${c.inserted} added`];
  if (c.updated) parts.push(`${c.updated} updated`);
  if (c.deleted) parts.push(`${c.deleted} removed`);
  if (c.accounts_created) parts.push(`${c.accounts_created} new account${c.accounts_created === 1 ? "" : "s"}`);
  if (r.rosterChanges) parts.push("account selection changed");
  if (r.ambiguousTransfers) parts.push(`${r.ambiguousTransfers} possible transfer${r.ambiguousTransfers === 1 ? "" : "s"} to review`);
  return `Synced — ${parts.join(", ")}.${r.historyComplete === false ? " Plaid is still preparing history." : ""}`;
}

type LinkMode = { kind: "connect" } | { kind: "update"; itemId: string };

export function ConnectedInstitutionsCard({
  items,
  configured,
  hasDemo,
}: {
  items: ConnectedItemSummary[];
  configured: boolean;
  hasDemo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ itemId: string; deleteData: boolean } | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const modeRef = useRef<LinkMode>({ kind: "connect" });
  const autoSynced = useRef(false);

  const run = (label: string, fn: () => Promise<{ error: string; warning?: string }>, onOk?: (r: { error: string; warning?: string }) => string | null) => {
    setError(null);
    setNotice(null);
    setBusy(label);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      setConfirming(null);
      if (res.error) setError(res.error);
      else {
        const msg = onOk ? onOk(res) : null;
        if (res.warning) setNotice(`⚠ ${res.warning}`);
        else if (msg) setNotice(msg);
        router.refresh();
      }
    });
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      setLinkToken(null);
      const mode = modeRef.current;
      if (!publicToken) {
        // Update mode returns no public token; a fresh connect always does.
        if (mode.kind === "connect") { setError("Plaid Link returned no token. Try again."); return; }
      }
      if (mode.kind === "connect") {
        run("connect", () => exchangePublicToken({
          publicToken: publicToken as string,
          institutionId: metadata.institution?.institution_id ?? null,
          institutionName: metadata.institution?.name ?? null,
        }), (r) => {
          const x = r as Awaited<ReturnType<typeof exchangePublicToken>>;
          return x.counts
            ? `Connected — ${x.counts.accounts_created} account${x.counts.accounts_created === 1 ? "" : "s"}, ${x.counts.inserted} transactions.${x.historyComplete ? "" : " Plaid is preparing your transaction history. Check again shortly."}`
            : "Connected.";
        });
      } else {
        run(mode.itemId, () => syncItem(mode.itemId, true), (r) => summarize(r as SyncResult));
      }
    },
    onExit: () => setLinkToken(null),
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  // Preparing-history Items re-sync once per visit (server throttle: 1 minute in that state).
  useEffect(() => {
    if (autoSynced.current) return;
    const loading = items.filter((i) => i.status === "initializing" || i.status === "history_loading");
    if (loading.length === 0) return;
    autoSynced.current = true;
    startTransition(async () => {
      let changed = false;
      for (const i of loading) {
        const r = await syncItem(i.id);
        if (!r.error && !r.throttled) changed = true;
      }
      if (changed) router.refresh();
    });
  }, [items, router]);

  const startLink = (mode: LinkMode) => {
    setError(null);
    setNotice(null);
    modeRef.current = mode;
    setBusy(mode.kind === "connect" ? "link" : mode.itemId);
    startTransition(async () => {
      const res = mode.kind === "connect" ? await createLinkToken() : await createUpdateLinkToken(mode.itemId);
      setBusy(null);
      if (res.error || !res.linkToken) setError(res.error || "Could not start Plaid Link.");
      else setLinkToken(res.linkToken);
    });
  };

  const visible = items.filter((i) => i.status !== "disconnected" || i.accountCount > 0);

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="connected-institutions">
      <div className="flex items-center gap-2">
        <Landmark size={16} aria-hidden className="text-secondary" />
        <h2 className="text-sm font-semibold text-primary">Connected institutions</h2>
      </div>

      {!configured ? (
        <p className="text-xs text-secondary">
          Bank connections are not configured in this environment. Add accounts manually or import statements instead.
        </p>
      ) : (
        <>
          <p className="text-xs text-secondary">
            Connect a bank through Plaid to keep transactions and balances synced. Balances show as of the last sync with Plaid, not live.
            Manual accounts — cash on hand, property, anything a bank doesn&apos;t see — stay exactly as they are.
          </p>
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
                const isBusy = busy === item.id;
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
                        <p className="text-[11px] text-tertiary">
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
                          disabled={pending}
                          onClick={() => run(item.id, () => (confirming.deleteData ? deleteItemData(item.id) : disconnectItem(item.id)), () =>
                            confirming.deleteData ? "Disconnected and deleted this institution's data." : "Disconnected — history kept.")}
                          className={dangerCls}
                        >
                          {isBusy ? "Working…" : confirming.deleteData ? "Confirm — delete its data" : "Confirm disconnect"}
                        </button>
                        <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={actionCls}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {item.status !== "disconnected" && item.status !== "disconnect_pending" && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(item.id, () => syncItem(item.id, true), (r) => summarize(r as SyncResult))}
                            className={actionCls}
                          >
                            {isBusy ? "Syncing…" : "Sync now"}
                          </button>
                        )}
                        {(item.status === "login_required" || item.status === "error") && (
                          <button type="button" disabled={pending} onClick={() => startLink({ kind: "update", itemId: item.id })} className={actionCls}>
                            Reconnect
                          </button>
                        )}
                        {item.status !== "disconnected" && (
                          <button type="button" disabled={pending} onClick={() => setConfirming({ itemId: item.id, deleteData: false })} className={actionCls}>
                            {item.status === "disconnect_pending" ? "Retry disconnect" : "Disconnect"}
                          </button>
                        )}
                        <button type="button" disabled={pending} onClick={() => setConfirming({ itemId: item.id, deleteData: true })} className={actionCls}>
                          {item.status === "disconnected" ? "Delete its data" : "Disconnect and delete data"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div>
            <button
              type="button"
              disabled={pending || busy === "link"}
              onClick={() => startLink({ kind: "connect" })}
              className="rounded-xl bg-positive-strong px-4 py-2 text-sm font-semibold text-base disabled:opacity-60"
            >
              {busy === "link" ? "Opening Plaid…" : busy === "connect" ? "Connecting…" : "Connect a bank"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
