"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight, CircleDot } from "lucide-react";
import { useTermSheet } from "@/components/concepts/TermSheetProvider";
import type { ConceptId } from "@/lib/concepts";
import type { ConceptProgressStatus } from "@/lib/concepts/progress";

const STATUS: Record<ConceptProgressStatus, { label: string; Icon: typeof CheckCircle2; tone: string }> = {
  completed: { label: "Completed", Icon: CheckCircle2, tone: "text-positive" },
  "in-progress": { label: "In progress", Icon: CircleDot, tone: "text-primary" },
  "not-started": { label: "Not started", Icon: ChevronRight, tone: "text-tertiary" },
};

export function ConceptRow({
  conceptId, title, shortDefinition, hasLesson, status, buildsOn,
}: {
  conceptId: ConceptId;
  title: string;
  shortDefinition: string;
  hasLesson: boolean;
  status: ConceptProgressStatus;
  buildsOn: string[];
}) {
  const { openTerm } = useTermSheet();
  const { label, Icon, tone } = STATUS[status];

  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-primary">{title}</span>
        <span className="truncate text-xs text-secondary">{shortDefinition}</span>
        {buildsOn.length > 0 && (
          <span className="mt-0.5 text-[11px] text-tertiary">Builds on: {buildsOn.join(", ")}</span>
        )}
      </span>
      {hasLesson ? (
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${tone}`}>
          <Icon size={14} aria-hidden />
          {label}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-tertiary">Definition</span>
      )}
    </>
  );

  const rowClass =
    "flex w-full items-center gap-3 rounded-xl border border-border-subtle bg-inset p-3 text-left transition-colors hover:border-border-strong";

  return hasLesson ? (
    <Link href={`/academy/${conceptId}`} className={rowClass}>{body}</Link>
  ) : (
    <button type="button" onClick={() => openTerm(conceptId)} className={rowClass}>{body}</button>
  );
}
