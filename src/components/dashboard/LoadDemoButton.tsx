"use client";

import { useFormStatus } from "react-dom";

export function LoadDemoButton({
  label = "Load demo data",
  pendingLabel = "Loading demo data…",
}: {
  label?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-xl bg-positive-strong px-5 py-3 text-sm font-semibold text-base disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
