import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

/** Empty state for screens scheduled in a later phase. */
export function ComingSoon({
  icon: Icon,
  title,
  phase,
  description,
}: {
  icon: LucideIcon;
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-primary">{title}</h1>
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-neutral-muted text-secondary"
        >
          <Icon size={24} />
        </span>
        <p className="text-sm font-medium text-primary">Coming in {phase}</p>
        <p className="max-w-sm text-sm text-secondary">{description}</p>
      </Card>
    </div>
  );
}
