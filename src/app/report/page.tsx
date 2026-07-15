import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/ui/ComingSoon";

export default function ReportPage() {
  return (
    <ComingSoon
      icon={FileText}
      title="Report"
      phase="Phase 1"
      description="Monthly and quarterly shareholder-style reports: income, operating expenses, free cash flow, owner-created equity, and management commentary."
    />
  );
}
