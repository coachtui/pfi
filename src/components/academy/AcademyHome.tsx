import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { CONCEPT_REGISTRY } from "@/lib/concepts";
import {
  academyTallies, conceptStatus, nextUpLesson, recentlyCompleted, type ProgressRow,
} from "@/lib/concepts/progress";
import { ConceptRow } from "./ConceptRow";
import { ProgressRing } from "./ProgressRing";

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function AcademyHome({ rows, degraded }: { rows: ProgressRow[]; degraded: boolean }) {
  const byId = new Map(rows.map((r) => [r.conceptId, r]));
  const tallies = academyTallies(CONCEPT_REGISTRY, rows);
  const nextUp = nextUpLesson(CONCEPT_REGISTRY, rows);
  const recent = recentlyCompleted(CONCEPT_REGISTRY, rows);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Academy</h1>
        <p className="mt-1 text-sm text-secondary">Master the language of finance.</p>
      </header>

      {degraded && (
        <p role="status" className="rounded-xl border border-border-subtle bg-inset p-3 text-xs text-secondary">
          Progress couldn&apos;t be loaded right now, so lessons are shown as not started. Your saved
          progress is unaffected.
        </p>
      )}

      <Card className="flex items-center gap-4 p-4">
        <ProgressRing percent={tallies.percentComplete} />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-primary">
            {tallies.lessonsCompleted} of {tallies.lessonsTotal} lessons
          </p>
          <p className="text-xs text-secondary">
            {tallies.modulesCompleted} of {tallies.modulesTotal} modules · {tallies.percentComplete}% complete
          </p>
        </div>
      </Card>

      {nextUp ? (
        <Card className="flex flex-col gap-2 p-4">
          <p className="text-xs font-medium tracking-wide text-tertiary uppercase">Continue learning</p>
          <p className="text-sm font-semibold text-primary">{nextUp.title}</p>
          <p className="text-xs text-secondary">{nextUp.shortDefinition}</p>
          <Link
            href={`/academy/${nextUp.id}`}
            className="mt-1 self-start rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-border-strong"
          >
            Continue
          </Link>
        </Card>
      ) : (
        <Card className="flex items-center gap-2 p-4">
          <CheckCircle2 size={16} aria-hidden className="text-positive" />
          <p className="text-sm text-primary">All lessons complete — every term now shows its full depth.</p>
        </Card>
      )}

      {CONCEPT_REGISTRY.modules.map((m) => (
        <section key={m.id} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-primary">
            Module {m.order} — {m.title}
          </h2>
          {CONCEPT_REGISTRY.forModule(m.id)
            .filter((c) => c.status === "published")
            .map((c) => (
              <ConceptRow
                key={c.id}
                conceptId={c.id}
                title={c.title}
                shortDefinition={c.shortDefinition}
                hasLesson={!!c.lesson}
                status={c.lesson ? conceptStatus(byId.get(c.id)) : "not-started"}
                buildsOn={c.prerequisiteConceptIds
                  .map((id) => CONCEPT_REGISTRY.byId(id)?.title)
                  .filter((t): t is string => !!t)}
              />
            ))}
        </section>
      ))}

      {recent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-primary">Recently completed</h2>
          {recent.map((r) => (
            <div key={r.conceptId} className="flex items-center justify-between rounded-xl border border-border-subtle bg-inset p-3">
              <span className="flex items-center gap-2 text-sm text-primary">
                <CheckCircle2 size={14} aria-hidden className="text-positive" />
                {r.title}
              </span>
              <span className="text-xs text-tertiary">{formatDay(r.completedAt)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
