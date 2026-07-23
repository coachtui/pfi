"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/Card";

/** Deterministic reconciliation line. State is carried by text + icon, never color alone. */
export function DivergenceExplainer({ sentence }: { sentence: string }) {
  return (
    <Card className="p-3">
      <div role="note" aria-label="How your two numbers relate">
        <p className="flex items-start gap-1.5 text-sm text-secondary">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>{sentence}</span>
        </p>
        <Link
          href="/academy/score-index-divergence"
          className="mt-1 inline-block text-xs font-medium text-secondary underline decoration-dotted underline-offset-2 hover:text-primary"
        >
          Learn
        </Link>
      </div>
    </Card>
  );
}
