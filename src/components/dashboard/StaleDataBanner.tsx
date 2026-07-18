"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, X } from "lucide-react";
import { dismissStaleNudge } from "@/app/actions/profile";

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** No-shame staleness nudge: a fact and an action, dismissible for a cycle.
 * Visibility is decided server-side (nudgeVisible); this only renders + dismisses. */
export function StaleDataBanner({ currentThrough }: { currentThrough: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true); // optimistic — server visibility catches up on refresh
    startTransition(async () => {
      await dismissStaleNudge();
      router.refresh();
    });
  };

  return (
    <p role="status" className="flex items-start gap-2 rounded-card border border-border-subtle bg-elevated p-3 text-sm text-secondary">
      <CalendarClock size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span className="flex-1">
        Your data is current through {formatLongDate(currentThrough)}.{" "}
        <Link href="/import" className="underline">Import your latest statements</Link> to keep your score accurate.
      </span>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        aria-label="Dismiss for now"
        className="rounded-lg p-1 text-tertiary transition-colors hover:text-primary disabled:opacity-60"
      >
        <X size={16} aria-hidden />
      </button>
    </p>
  );
}
