import Link from "next/link";
import { Database, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { loadDemoData } from "@/app/actions/demo";
import { LoadDemoButton } from "@/components/dashboard/LoadDemoButton";
import { DEMO_PROFILE_METAS } from "@/lib/demo-data/profiles";

export function EmptyDashboard({ companyName }: { companyName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-primary">{companyName}</h1>
      <Card className="flex flex-col items-center gap-4 p-10 text-center">
        <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-neutral-muted text-secondary">
          <Database size={24} />
        </span>
        <div>
          <p className="text-sm font-medium text-primary">No financial data yet</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">
            Load the sample dataset to explore, or import your real transactions from a bank CSV.
          </p>
        </div>
        <div className="flex w-full max-w-sm flex-col gap-2">
          {DEMO_PROFILE_METAS.map((m) => (
            <form key={m.id} action={async () => { await loadDemoData(m.id); }} className="flex flex-col items-center gap-1">
              <LoadDemoButton label={`Load ${m.companyName}`} pendingLabel="Loading demo data…" />
              <p className="text-xs text-secondary">{m.description}</p>
            </form>
          ))}
        </div>
        <Link
          href="/import"
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:text-primary"
        >
          <Upload size={14} aria-hidden /> Import a CSV from your bank
        </Link>
      </Card>
    </div>
  );
}
