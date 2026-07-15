import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/ui/ComingSoon";

export default function DataPage() {
  return (
    <ComingSoon
      icon={BarChart3}
      title="Data"
      phase="Phase 1"
      description="Benchmark intelligence: household financial-conditions index, cohort medians, and percentile comparisons — always aggregated, never individual."
    />
  );
}
