import Link from "next/link";
import { Hourglass } from "lucide-react";

/**
 * Partial-history product state (spec §5 step 4, acceptance criterion §13.4):
 * shown while any connected Item has not finished loading its transaction
 * history. Data is available but marked provisional — never withheld.
 * Glyph + text, never color alone.
 */
export function HistoryLoadingNotice() {
  return (
    <p
      role="status"
      data-testid="history-loading-notice"
      className="flex items-start gap-2 rounded-card border border-border-subtle bg-elevated p-3 text-sm text-secondary"
    >
      <Hourglass size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span className="flex-1">
        Transaction history is still loading from Plaid. Your index and score are provisional until it completes.{" "}
        <Link href="/accounts" className="underline">Check connections</Link>
      </span>
    </p>
  );
}
