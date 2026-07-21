"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Bottom sheet on mobile, centered dialog on ≥sm. Purely presentational. */
export function Sheet({
  open,
  onClose,
  title,
  contentKey,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /**
   * Identifies the content currently shown inside the sheet. Defaults to `title`.
   * Pass a value that changes whenever the sheet's content is swapped out while
   * `open` stays `true` (e.g. navigating between related concepts) so focus is
   * re-anchored inside the panel and the Tab-trap can't be escaped by a stale
   * `document.activeElement` left on `<body>` after the previously-focused
   * element unmounts.
   */
  contentKey?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const resolvedContentKey = contentKey ?? title;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Capture the pre-open trigger element once (on the closed→open transition) and
  // restore focus to it once (on the open→closed transition). Deliberately keyed
  // only on `open`, not `contentKey`: the element that should regain focus on
  // close is the one that opened the sheet, not whichever related-concept chip
  // was tapped most recently inside it.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
    } else {
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    }
  }, [open]);

  // Re-anchor focus inside the panel whenever it opens AND whenever its content
  // changes while it stays open (e.g. related-concept navigation). Without the
  // `contentKey` dependency, swapping content unmounts the previously-focused
  // element, the browser moves `document.activeElement` to `<body>`, and the
  // Tab-trap above (which only checks against `first`/`last`) never matches — so
  // the next Tab escapes to background content instead of cycling the panel.
  useEffect(() => {
    if (!open) return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? panelRef.current)?.focus();
  }, [open, resolvedContentKey]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-border-subtle bg-elevated p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-secondary hover:text-primary"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
