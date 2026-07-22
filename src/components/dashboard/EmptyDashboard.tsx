import Link from "next/link";
import { CheckCircle2, Database, FileText, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { loadDemoDataForForm } from "@/app/actions/demo";
import { LoadDemoButton } from "@/components/dashboard/LoadDemoButton";
import { DEMO_PROFILE_METAS } from "@/lib/demo-data/profiles";

export function EmptyDashboard({ companyName }: { companyName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-primary">{companyName}</h1>

      <Card className="flex items-center gap-2.5 px-4 py-3">
        <CheckCircle2 size={16} aria-hidden className="shrink-0 text-secondary" />
        <p className="text-sm text-secondary">You&apos;re set up. Now bring in your finances.</p>
      </Card>

      <Card className="flex flex-col items-center gap-4 p-10 text-center">
        <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-neutral-muted text-secondary">
          <Database size={24} />
        </span>
        <div>
          <p className="text-sm font-medium text-primary">Import your finances</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">
            Bank CSV or a statement PDF. Everything is reviewed before it touches your record.
          </p>
        </div>
        <Link
          href="/import"
          className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity hover:opacity-90"
        >
          <Upload size={18} aria-hidden /> Import financial data
        </Link>
        <p className="flex max-w-sm items-center justify-center gap-1.5 text-xs text-tertiary">
          <FileText size={13} aria-hidden /> CSV is best for accuracy · PDF is a reviewed fallback
        </p>
      </Card>

      <div className="border-t border-border-subtle" />

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-tertiary">Just exploring?</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {DEMO_PROFILE_METAS.map((m) => (
            <form key={m.id} action={loadDemoDataForForm.bind(null, m.id)} className="flex flex-col gap-1.5">
              <LoadDemoButton label={m.companyName} pendingLabel="Loading…" variant="secondary" />
              <p className="text-left text-[11px] leading-snug text-tertiary">{m.description}</p>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
