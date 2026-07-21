import type { ConceptLiveData } from "@/lib/data/concept-live";

/**
 * "Apply it to the household": live data when available, clearly-labeled
 * sample otherwise (spec §Section 6 + §Personalized content rules).
 * Standalone so it can migrate into a future "Your Data" tab untouched.
 */
export function HouseholdApplication({
  live,
  genericExample,
}: {
  live: ConceptLiveData | null;
  genericExample: string;
}) {
  if (live) {
    return (
      <div className="rounded-xl border border-border-subtle bg-inset p-3">
        <span className="mb-1 inline-block rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-tertiary">
          Calculated from your data
        </span>
        <p className="text-sm text-primary">
          {live.periodLabel}: <span className="tabular font-semibold">{live.display}</span>
        </p>
        {live.deltaDisplay && <p className="mt-0.5 text-xs text-secondary">{live.deltaDisplay}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border-subtle bg-inset p-3">
      <span className="mb-1 inline-block rounded-full border border-border-subtle px-2 py-0.5 text-[11px] text-tertiary">
        Sample household
      </span>
      <p className="text-sm text-secondary">{genericExample}</p>
    </div>
  );
}
