"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Segmented";
import { momentumLabel, type ConfidenceLevel, type MomentumState } from "@/lib/financial-engine";
import { branding } from "@/lib/config/branding";
import type { ScoreData, ScoreRange } from "@/lib/data/queries";

const RANGE_OPTIONS: Array<{ key: ScoreRange; label: string }> = [
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

const MOMENTUM_GLYPH: Record<MomentumState, string> = {
  strongly_improving: "▲▲",
  improving: "▲",
  recovering: "▲",
  stable: "—",
  weakening: "▼",
  deteriorating: "▼▼",
  insufficient_history: "…",
};

const CONFIDENCE_COPY: Record<ConfidenceLevel | "insufficient_data", string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  limited: "Limited confidence",
  insufficient_data: "Not enough data",
};

const chipCls = "rounded-full border border-border-subtle px-2 py-0.5 text-xs text-secondary";

/** Signed point delta, e.g. "+12" / "−5", matching formatSignedDollars/Percent style. */
function signedPoints(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${Math.abs(n)}`;
}

export function ScoreView({ data }: { data: ScoreData }) {
  const router = useRouter();
  const { breakdown, delta, momentum, improvements, range } = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Back to dashboard" className="rounded-lg p-1 text-secondary hover:text-primary">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-primary">{branding.productName} Score</h1>
          <p className="text-xs text-secondary">Measures your financial operating health. Not a credit score.</p>
        </div>
      </div>

      {/* Overall */}
      <Card className="p-4">
        {breakdown.state === "suppressed" ? (
          <div>
            <p className="text-base font-medium text-primary">Your score isn&apos;t available yet</p>
            {breakdown.notes.map((n) => (
              <p key={n} className="mt-1 text-sm text-secondary">
                {n}
              </p>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="tabular text-4xl font-bold text-primary">{breakdown.overall}</span>
              <span className="text-sm text-secondary">/ 900 · {breakdown.band}</span>
              {breakdown.state === "provisional" && (
                <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-xs text-secondary">
                  Provisional
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={chipCls}>
                {MOMENTUM_GLYPH[momentum]} {momentumLabel(momentum)}
              </span>
              <span className={chipCls}>{CONFIDENCE_COPY[breakdown.overallConfidence]}</span>
            </div>
            {breakdown.notes.map((n) => (
              <p key={n} className="text-xs text-tertiary">
                {n}
              </p>
            ))}
          </div>
        )}
      </Card>

      {/* What changed */}
      <section aria-label="What changed">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-primary">What changed</h2>
          <Segmented
            ariaLabel="Score range"
            options={RANGE_OPTIONS}
            value={range}
            onChange={(key) => router.replace(`/score?range=${key}`)}
          />
        </div>
        <Card className="p-4">
          {delta.state === "insufficient_history" ? (
            <p className="text-sm text-secondary">{delta.notes.join(" ")}</p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              {delta.change === null ? (
                <p className="text-secondary">— Not comparable for this range.</p>
              ) : (
                <p className="text-primary">
                  {delta.change === 0 ? (
                    "No change"
                  ) : (
                    <span className={delta.change > 0 ? "text-positive" : "text-negative"}>
                      {signedPoints(delta.change)} points
                    </span>
                  )}{" "}
                  <span className="tabular text-secondary">
                    ({delta.from} → {delta.to})
                  </span>
                </p>
              )}

              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {delta.dimensions.map((d) => (
                  <li key={d.key} className="flex items-center justify-between gap-2">
                    <span className="text-tertiary">{d.label}</span>
                    <span className="tabular text-secondary">
                      {d.change === null ? "—" : signedPoints(d.change)}
                    </span>
                  </li>
                ))}
              </ul>

              {delta.topMovers.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold tracking-wide text-tertiary uppercase">Top movers</h3>
                  <ul className="flex flex-col gap-1">
                    {delta.topMovers.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2">
                        <span className="text-primary">{m.name}</span>
                        <span className="tabular text-secondary">{signedPoints(m.overallPointsImpact)} pts</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {delta.notes.map((n) => (
                <p key={n} className="text-xs text-tertiary">
                  {n}
                </p>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* Dimensions */}
      <section aria-label="Score dimensions" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-primary">The six dimensions</h2>
        {breakdown.dimensions.map((d) => (
          <Card key={d.key} className="p-4">
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-primary">{d.label}</span>
                  <span className="flex items-center gap-2 text-sm">
                    {d.score !== null ? (
                      <span className="tabular text-primary">
                        {d.score}
                        <span className="text-tertiary">/100</span>
                      </span>
                    ) : (
                      <span className="text-tertiary">Not enough data</span>
                    )}
                    <span className={chipCls}>{CONFIDENCE_COPY[d.confidence]}</span>
                    <ChevronDown
                      size={16}
                      className="shrink-0 text-tertiary transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </span>
                </span>
                {d.score === null && d.exclusionReason && (
                  <span className="text-xs text-tertiary">{d.exclusionReason}</span>
                )}
              </summary>
              <div className="mt-3 flex flex-col gap-3 border-t border-border-subtle pt-3">
                {d.metrics.map((m) => (
                  <div key={m.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-primary">
                        {m.name}
                        {!m.scored && <span className="ml-1 text-xs text-tertiary">(context only)</span>}
                      </span>
                      <span className="tabular text-secondary">
                        {m.availability === "available" ? m.formatted : m.reason}
                      </span>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-secondary hover:text-primary">
                        How is this calculated?
                      </summary>
                      <div className="mt-1 flex flex-col gap-1 text-xs text-tertiary">
                        <p>{m.definition}</p>
                        {m.scored && m.curveScore !== null && (
                          <p>
                            Contributes {m.curveScore}/100 to {d.label}.
                          </p>
                        )}
                        {m.assumptions.map((a) => (
                          <p key={a}>Assumes: {a}</p>
                        ))}
                        {m.limitations.map((l) => (
                          <p key={l}>Limitation: {l}</p>
                        ))}
                        {m.availability !== "available" && m.reason && <p>Not available: {m.reason}</p>}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            </details>
          </Card>
        ))}

        {/* Protection — visible, unscored */}
        <Card className="p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-primary">Protection</span>
            <span className="text-tertiary">Not assessed</span>
          </div>
          <p className="mt-1 text-xs text-tertiary">
            Insurance and estate readiness matter, but we don&apos;t guess from bank data. Protection is not part of
            your score yet.
          </p>
        </Card>
      </section>

      {/* Weights + confidence */}
      {breakdown.state === "provisional" && (
        <Card className="p-4">
          <h2 className="text-sm font-medium text-primary">Weights used for this score</h2>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {breakdown.dimensions
              .filter((d) => d.eligible)
              .map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-2">
                  <span className="text-secondary">{d.label}</span>
                  <span className="tabular text-primary">
                    {Math.round((breakdown.effectiveWeights[d.key] ?? 0) * 100)}%
                    <span className="text-tertiary"> (normally {Math.round(d.configuredWeight * 100)}%)</span>
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {improvements.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-medium text-primary">What would improve accuracy</h2>
          <ul className="mt-2 list-disc pl-4 text-sm text-secondary">
            {improvements.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
