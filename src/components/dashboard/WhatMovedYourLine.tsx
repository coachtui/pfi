"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Banknote,
  ChevronDown,
  CreditCard,
  Home,
  PiggyBank,
  Receipt,
  Shield,
  Star,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import {
  driverDisplay,
  driverExplanationText,
  EVENT_TYPE_LABELS,
  formatDollars,
  type Driver,
} from "@/lib/financial-engine";
import { formatShortDate, formatSignedDollars } from "@/lib/financial-engine/format";
import type { FinancialEventType } from "@/lib/financial-engine/types";
import type { DriverExplanationsResult } from "@/lib/data/narration";

export const eventIcons: Record<FinancialEventType, LucideIcon> = {
  paycheck: Banknote,
  bonus: Star,
  mortgage_payment: Home,
  large_purchase: Receipt,
  insurance_payment: Shield,
  investment_contribution: TrendingUp,
  debt_payment: CreditCard,
  debt_payoff: CreditCard,
  tax_payment: Receipt,
  unexpected_expense: Receipt,
};

/**
 * The AI explanation for a driver, matched defensively: the AI input was
 * built over the default 30-day window, but the UI's drivers follow the
 * selected chart range. A driver only gets its AI text when it is
 * demonstrably the same event (position, type, date, and rounded impact all
 * agree); otherwise that panel falls back to the deterministic text. Range
 * switches therefore degrade per-card, gracefully, by construction.
 */
function aiBodyFor(
  driver: Driver,
  index: number,
  result: DriverExplanationsResult | null,
): string | null {
  if (!result) return null;
  const d = result.input.drivers[index];
  if (!d || d.kind !== driver.event.type || d.date !== driver.event.date) return null;
  if (Math.round(d.impact) !== Math.round(driver.impact)) return null;
  return result.output.explanations.find((e) => e.driverId === d.id)?.body ?? null;
}

/**
 * Deterministic "What moved your line" accordion. Drivers come straight
 * from the engine; the AI layer supplies wording only (aiResult null =
 * keyless/loading/failed, and every panel still works deterministically).
 */
export function WhatMovedYourLine({
  drivers,
  aiResult,
}: {
  drivers: Driver[];
  aiResult: DriverExplanationsResult | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Reset the open panel whenever the drivers list changes (e.g. the user
  // switches chart range). Without this, an event id that disappears and
  // later reappears (a different range containing the same event) would
  // silently reopen its panel with no further tap. Adjusted during render
  // (React's recommended pattern for resetting state on a prop change)
  // rather than in a useEffect, which would call setState after an extra
  // commit and trip this project's set-state-in-effect lint rule.
  const [prevDrivers, setPrevDrivers] = useState(drivers);
  if (drivers !== prevDrivers) {
    setPrevDrivers(drivers);
    setExpandedId(null);
  }

  if (drivers.length === 0) {
    return (
      <p className="rounded-card border border-border-subtle bg-elevated p-4 text-sm text-secondary">
        No significant financial events in this period.
      </p>
    );
  }

  const totalMovement = drivers.reduce((s, d) => s + Math.abs(d.impact), 0);
  const expanded = drivers.find((d) => d.event.id === expandedId) ?? null;
  const expandedIndex = expanded ? drivers.indexOf(expanded) : -1;
  const expandedAiBody = expanded ? aiBodyFor(expanded, expandedIndex, aiResult) : null;

  return (
    <div>
      <ul className="grid grid-cols-4 gap-2 md:gap-3">
        {drivers.map((driver) => {
          const { event } = driver;
          const display = driverDisplay(driver);
          const Icon = eventIcons[event.type] ?? Receipt;
          const positive = display.tone === "positive";
          const isOpen = expandedId === event.id;
          return (
            <li key={event.id}>
              <button
                type="button"
                id={`driver-card-${event.id}`}
                aria-expanded={isOpen}
                aria-controls={`driver-panel-${event.id}`}
                aria-label={`${event.label}, ${formatSignedDollars(display.displayAmount)} on ${formatShortDate(event.date)}. ${isOpen ? "Hide" : "Show"} explanation`}
                onClick={() => setExpandedId(isOpen ? null : event.id)}
                className="block h-full w-full text-left"
              >
                <Card
                  className={`flex h-full min-h-24 flex-col justify-between gap-1 p-2.5 transition-colors hover:border-border-strong sm:min-h-28 sm:p-4 ${
                    isOpen ? "border-border-strong" : ""
                  }`}
                >
                  <span className="flex items-start justify-between">
                    <span
                      aria-hidden
                      className={`flex size-7 items-center justify-center rounded-full sm:size-9 ${
                        positive ? "bg-positive-muted text-positive" : "bg-negative-muted text-negative"
                      }`}
                    >
                      {display.buildsEquity ? <PiggyBank size={15} /> : <Icon size={15} />}
                    </span>
                    <ChevronDown
                      aria-hidden
                      size={14}
                      className={`shrink-0 text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                  <p className="truncate text-[11px] leading-tight font-medium text-primary sm:text-sm">
                    {event.label}
                  </p>
                  <p
                    className={`tabular text-xs font-semibold sm:text-sm ${
                      positive ? "text-positive" : "text-negative"
                    }`}
                  >
                    {formatSignedDollars(display.displayAmount)}
                  </p>
                  <p className="text-[10px] text-tertiary sm:text-xs">{formatShortDate(event.date)}</p>
                </Card>
              </button>
            </li>
          );
        })}
      </ul>
      {expanded && (
        <DriverPanel
          driver={expanded}
          aiBody={expandedAiBody}
          totalMovement={totalMovement}
        />
      )}
    </div>
  );
}

function DriverPanel({
  driver,
  aiBody,
  totalMovement,
}: {
  driver: Driver;
  aiBody: string | null;
  totalMovement: number;
}) {
  const { event } = driver;
  const display = driverDisplay(driver);
  const body = aiBody ?? driverExplanationText(driver, { totalMovement });
  const share = totalMovement > 0 ? Math.round((Math.abs(driver.impact) / totalMovement) * 100) : 0;
  return (
    <div
      id={`driver-panel-${event.id}`}
      role="region"
      aria-labelledby={`driver-card-${event.id}`}
      className="mt-2"
    >
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-primary">{event.label}</p>
          <span className="shrink-0 rounded-full bg-neutral-muted px-2.5 py-0.5 text-[11px] font-medium text-secondary">
            {aiBody ? "AI narrative · numbers calculated" : "Calculated"}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-secondary">{body}</p>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-tertiary">
            How is this generated?
          </summary>
          <div className="mt-2 flex flex-col gap-1 text-xs text-tertiary">
            <p>
              {aiBody
                ? "The wording is AI-written from these verified, code-calculated facts only — the AI never sees raw transactions and cannot change any number:"
                : "Built directly from these verified, code-calculated facts:"}
            </p>
            <ul className="list-disc pl-4">
              <li>{EVENT_TYPE_LABELS[event.type]} on {event.date}</li>
              <li>Impact on available capital: {formatDollars(driver.impact)}</li>
              {display.buildsEquity && <li>Builds owner-created equity</li>}
              {share > 0 && <li>{share}% of this period&#39;s total driver movement</li>}
            </ul>
          </div>
        </details>
        <Link
          href={`/transactions?from=${event.date}&to=${event.date}&label=${encodeURIComponent(event.label)}`}
          className="mt-3 inline-block text-sm font-medium text-primary underline decoration-dotted underline-offset-2 hover:text-secondary"
        >
          View transactions →
        </Link>
      </Card>
    </div>
  );
}
