"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowLeft, Upload } from "lucide-react";
import { uploadStatementPdf } from "@/app/actions/imports";
import type { PdfReviewData } from "@/lib/pdf-import/types";
import { InlineError } from "@/components/ui/InlineError";

export function PdfUploadStep({
  accountId,
  accountName,
  onBack,
  onReady,
}: {
  accountId: string;
  accountName: string;
  onBack?: () => void;
  onReady: (review: PdfReviewData) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(file: File) {
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("accountId", accountId);
    startTransition(async () => {
      const result = await uploadStatementPdf(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.review) onReady(result.review);
    });
  }

  return (
    <section className="space-y-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"
        >
          <ArrowLeft size={16} aria-hidden /> Back
        </button>
      )}

      <div className="rounded-card border border-border-subtle bg-elevated px-3 py-2">
        <p className="text-xs text-secondary">Importing into</p>
        <p className="text-sm font-semibold text-primary">{accountName}</p>
      </div>

      <input
        ref={inputRef}
        id="statement-pdf"
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) submit(f);
        }}
      />

      <div className="rounded-card border border-dashed border-border-strong bg-inset p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-lg bg-positive-strong/10 p-3">
            <Upload size={24} className="text-positive-strong" aria-hidden />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-primary">Drop your statement here</p>
            <p className="text-xs text-secondary">or choose a file</p>
          </div>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          aria-busy={pending}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
        >
          <Upload size={18} aria-hidden /> {pending ? "Uploading and extracting..." : "Choose PDF file"}
        </button>

        <p className="mt-4 text-center text-xs text-tertiary">
          PDF up to 10 MB · checking, savings & credit-card statements
        </p>
      </div>

      {pending && <p role="status" className="text-sm text-secondary">Extracting statement text. This may take a moment.</p>}
      <InlineError message={error} />
      <p className="text-xs text-tertiary">
        Statements are stored privately for your account. Keep this screen open until review appears; background uploads are not enabled yet.
      </p>
    </section>
  );
}
