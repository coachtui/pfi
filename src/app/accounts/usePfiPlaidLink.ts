"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { createLinkToken, createUpdateLinkToken, exchangePublicToken, syncItem, type SyncResult } from "@/app/actions/plaid";
import { clearLinkSession, linkStorage, saveLinkSession, type LinkMode, type LinkResult, type LinkSession } from "./link-session";

export type LinkBusy = "link" | "connect" | { itemId: string } | null;

export function summarizeSync(r: SyncResult): string {
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

function summarizeExchange(x: Awaited<ReturnType<typeof exchangePublicToken>>): string {
  return x.counts
    ? `Connected — ${x.counts.accounts_created} account${x.counts.accounts_created === 1 ? "" : "s"}, ${x.counts.inserted} transactions.${x.historyComplete ? "" : " Plaid is preparing your transaction history. Check again shortly."}`
    : "Connected.";
}

/**
 * The one Plaid Link lifecycle for PFI (spec §1a): token creation, session
 * persistence across an OAuth round-trip, opening Link, and finishing with
 * the exchange (connect) or a sync (update mode). Used by the Accounts card
 * and by `/plaid/oauth`, so the two can never drift.
 *
 * `resume` re-initializes Link at the OAuth redirect URI with the stored
 * session; `receivedRedirectUri` must be the full return URL in that case.
 */
export function usePfiPlaidLink(opts: {
  /** The signed-in user; bound into the stored session so a resume by anyone else is refused. */
  userId: string;
  onResult: (result: LinkResult) => void;
  /** Link closed without a result (user backed out). */
  onCancel?: () => void;
  resume?: LinkSession | null;
  receivedRedirectUri?: string;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(opts.resume?.linkToken ?? null);
  const modeRef = useRef<LinkMode>(opts.resume?.mode ?? { kind: "connect" });
  const [busy, setBusy] = useState<LinkBusy>(null);
  const [pending, startTransition] = useTransition();
  // Latest callbacks, read only from Link's callbacks (never during render).
  const onResultRef = useRef(opts.onResult);
  const onCancelRef = useRef(opts.onCancel);
  useEffect(() => {
    onResultRef.current = opts.onResult;
    onCancelRef.current = opts.onCancel;
  });

  const finish = useCallback((publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
    const mode = modeRef.current;
    if (mode.kind === "connect" && !publicToken) {
      onResultRef.current({ ok: false, message: "Plaid Link returned no token. Try again." });
      return;
    }
    setBusy(mode.kind === "connect" ? "connect" : { itemId: mode.itemId });
    startTransition(async () => {
      try {
        if (mode.kind === "connect") {
          const res = await exchangePublicToken({
            publicToken: publicToken as string,
            institutionId: metadata.institution?.institution_id ?? null,
            institutionName: metadata.institution?.name ?? null,
          });
          onResultRef.current(res.error
            ? { ok: false, message: res.error }
            : res.warning ? { ok: true, warning: true, message: res.warning } : { ok: true, message: summarizeExchange(res) });
        } else {
          const res = await syncItem(mode.itemId);
          onResultRef.current(res.error
            ? { ok: false, message: res.error }
            : res.warning ? { ok: true, warning: true, message: res.warning } : { ok: true, message: summarizeSync(res) });
        }
      } finally {
        setBusy(null);
      }
    });
  }, []);

  const { open, ready, error: sdkError } = usePlaidLink({
    token: linkToken,
    // Only while a token is live: react-plaid-link re-creates a handler whenever
    // token OR receivedRedirectUri is set, so leaving the URI in place after
    // success would spin up a second, tokenless Link on the return page.
    receivedRedirectUri: linkToken ? opts.receivedRedirectUri : undefined,
    onSuccess: (publicToken, metadata) => {
      setLinkToken(null);
      clearLinkSession(linkStorage());
      finish(publicToken, metadata);
    },
    onExit: (err) => {
      setLinkToken(null);
      clearLinkSession(linkStorage());
      if (err) onResultRef.current({ ok: false, message: `Plaid Link closed with an error (${err.error_code ?? "unknown"}). Try again.` });
      else onCancelRef.current?.();
    },
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  useEffect(() => {
    if (sdkError) onResultRef.current({ ok: false, message: "Plaid Link could not load. Check your connection and try again." });
  }, [sdkError]);

  /** Create a token for the mode, persist the session, and open Link. */
  const startLink = useCallback((mode: LinkMode) => {
    modeRef.current = mode;
    setBusy("link");
    startTransition(async () => {
      const res = mode.kind === "connect" ? await createLinkToken() : await createUpdateLinkToken(mode.itemId);
      setBusy(null);
      if (res.error || !res.linkToken) {
        onResultRef.current({ ok: false, message: res.error || "Could not start Plaid Link." });
        return;
      }
      saveLinkSession(linkStorage(), { linkToken: res.linkToken, mode, userId: opts.userId });
      setLinkToken(res.linkToken);
    });
  }, [opts.userId]);

  return { startLink, busy, pending, linkOpen: linkToken !== null };
}
