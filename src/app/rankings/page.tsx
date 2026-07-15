import { Trophy } from "lucide-react";
import { ComingSoon } from "@/components/ui/ComingSoon";

export default function RankingsPage() {
  return (
    <ComingSoon
      icon={Trophy}
      title="Rankings"
      phase="Phase 1"
      description="Anonymized cohort leagues ranked by normalized improvement — never by absolute wealth. Age, income, region, and overall leagues with quarterly challenges."
    />
  );
}
