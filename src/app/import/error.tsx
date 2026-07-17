"use client";

import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Card className="flex flex-col items-center gap-4 p-10 text-center">
        <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-warning-muted text-warning">
          <AlertTriangle size={24} />
        </span>
        <div>
          <p className="text-sm font-medium text-primary">Something went wrong loading the import screen</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">Your data is safe. Try again in a moment.</p>
        </div>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-positive-strong px-5 py-3 text-sm font-semibold text-base"
        >
          Try again
        </button>
      </Card>
    </div>
  );
}
