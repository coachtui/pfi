import { BadgeCheck, TreePalm } from "lucide-react";

interface CompanyHeaderProps {
  companyName: string;
  ticker: string;
  username: string;
  level?: number;
}

/** Personal-company identity block shown at the top of the dashboard. */
export function CompanyHeader({ companyName, ticker, username, level }: CompanyHeaderProps) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full border border-positive/50 text-positive"
        >
          <TreePalm size={24} />
        </span>
        <div>
          <h1 className="text-lg leading-tight font-semibold text-primary">{companyName}</h1>
          <p className="tabular text-sm font-medium text-positive">{ticker}</p>
          <p className="flex items-center gap-1 text-xs text-secondary">
            {username}
            <BadgeCheck size={13} className="text-positive" aria-label="Verified data coverage" />
          </p>
        </div>
      </div>
      {level !== undefined && (
        <span className="relative flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-positive/30 via-elevated-2 to-[color:var(--chart-waterline)]/20 text-positive">
          <TreePalm size={22} aria-hidden />
          <span className="absolute -bottom-1 rounded-full border border-border-subtle bg-elevated px-1.5 text-[9px] font-semibold text-secondary">
            LV. {level}
          </span>
          <span className="sr-only">Level {level}</span>
        </span>
      )}
    </header>
  );
}
