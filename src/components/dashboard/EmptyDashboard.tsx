import { Database } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { loadDemoData } from "@/app/actions/demo";

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
            Load the sample dataset to explore, or add accounts once manual entry ships.
          </p>
        </div>
        <form action={loadDemoData}>
          <button type="submit" className="rounded-xl bg-positive-strong px-5 py-3 text-sm font-semibold text-base">
            Load demo data
          </button>
        </form>
      </Card>
    </div>
  );
}
