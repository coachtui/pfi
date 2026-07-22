import { AlertCircle } from "lucide-react";

/** Inline form/action error. Pairs an icon with text so state is never color-only. */
export function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-negative/30 bg-negative-muted px-3 py-2 text-sm text-negative"
    >
      <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}
