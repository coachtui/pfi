"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/Card";

const LEARN_COPY =
  "These track different time horizons. PFI behaves like a share price and reacts to recent cash movement; the Fundamentals Score measures your 90-day financial health. A short-term cash swing can move one without the other.";

/** Deterministic reconciliation line. State is carried by text + icon, never color alone. */
export function DivergenceExplainer({ sentence }: { sentence: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-3">
      <div role="note" aria-label="How your two numbers relate">
        <p className="flex items-start gap-1.5 text-sm text-secondary">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>{sentence}</span>
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 text-xs font-medium text-secondary underline decoration-dotted underline-offset-2 hover:text-primary"
        >
          {open ? "Hide" : "Learn"}
        </button>
        {open && <p className="mt-2 text-xs text-tertiary">{LEARN_COPY}</p>}
      </div>
    </Card>
  );
}
