"use client";

import Link from "next/link";
import { KeyRound, Landmark, ShieldCheck } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { branding } from "@/lib/config/branding";

/**
 * Just-in-time disclosure before the first Plaid Link open on a device
 * (spec §1b). A notice, not a recorded consent — the recorded consent is the
 * privacy policy version accepted at the consent gate.
 */
export function ConnectDisclosureSheet({ open, onClose, onContinue }: { open: boolean; onClose: () => void; onContinue: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="How connecting works">
      <ul className="flex flex-col gap-3 text-sm text-secondary">
        <li className="flex gap-3">
          <KeyRound size={18} aria-hidden className="mt-0.5 shrink-0 text-primary" />
          <span>You sign in at your bank through Plaid. Your bank password goes to Plaid, never to {branding.productName}.</span>
        </li>
        <li className="flex gap-3">
          <Landmark size={18} aria-hidden className="mt-0.5 shrink-0 text-primary" />
          <span>{branding.productName} receives account names, the last digits of account numbers, balances, and transactions — nothing else.</span>
        </li>
        <li className="flex gap-3">
          <ShieldCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-primary" />
          <span>Disconnect at any time from Accounts. &ldquo;Disconnect and delete data&rdquo; removes everything that came through the connection.</span>
        </li>
      </ul>
      <p className="mt-4 text-xs text-tertiary">
        Details are in the <Link href="/privacy#connected-accounts" className="underline">privacy policy</Link> and Plaid&apos;s{" "}
        <a href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noreferrer" className="underline">End User Privacy Policy</a>.
      </p>
      <button
        type="button"
        onClick={onContinue}
        className="mt-5 w-full rounded-xl bg-positive-strong px-4 py-2.5 text-sm font-semibold text-base"
      >
        Continue to Plaid
      </button>
    </Sheet>
  );
}
