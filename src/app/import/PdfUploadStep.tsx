"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowLeft, FileText, Upload } from "lucide-react";
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
      <div className="rounded-card border border-border-subtle bg-elevated p-4">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 shrink-0 text-secondary" size={20} aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-primary">Upload statement PDF</h2>
            <p className="mt-1 text-sm text-secondary">
              Use a bank or credit-card statement when CSV export is unavailable. Extracted data is staged for review before it is added to PFI.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-card border border-border-subtle bg-elevated p-3">
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
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        aria-busy={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
      >
        <Upload size={18} aria-hidden /> {pending ? "Uploading and extracting..." : "Choose PDF file"}
      </button>
      {pending && <p role="status" className="text-sm text-secondary">Extracting statement text. This may take a moment.</p>}
      <InlineError message={error} />
      <p className="text-xs text-tertiary">
        Statements are stored privately for your account. Keep this screen open until review appears; background uploads are not enabled yet.
      </p>
    </section>
  );
}
