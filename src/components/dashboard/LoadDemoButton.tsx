"use client";

import { useFormStatus } from "react-dom";

export function LoadDemoButton({
  label = "Load demo data",
  pendingLabel = "Loading demo data…",
  variant = "primary",
}: {
  label?: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={
        variant === "primary"
          ? "rounded-xl bg-positive-strong px-5 py-3 text-sm font-semibold text-base disabled:opacity-60"
          : "w-full rounded-lg border border-border-subtle bg-inset px-3 py-2 text-left text-xs font-medium text-secondary transition-colors hover:text-primary disabled:opacity-60"
      }
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
