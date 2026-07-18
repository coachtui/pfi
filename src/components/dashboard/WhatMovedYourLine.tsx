import Link from "next/link";
import {
  Banknote,
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
import { driverDisplay, type Driver } from "@/lib/financial-engine";
import { formatShortDate, formatSignedDollars } from "@/lib/financial-engine/format";
import type { FinancialEventType } from "@/lib/financial-engine/types";

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
 * Deterministic "What moved your line" section. Drivers come straight from
 * the engine; this component only renders them. The AI narrative layer
 * (Phase 4) will sit alongside, never replace, this list.
 */
export function WhatMovedYourLine({ drivers }: { drivers: Driver[] }) {
  if (drivers.length === 0) {
    return (
      <p className="rounded-card border border-border-subtle bg-elevated p-4 text-sm text-secondary">
        No significant financial events in this period.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-4 gap-2 md:gap-3">
      {drivers.map((driver) => {
        const { event } = driver;
        const display = driverDisplay(driver);
        const Icon = eventIcons[event.type] ?? Receipt;
        const positive = display.tone === "positive";
        return (
          <li key={event.id}>
            <Link
              href={`/transactions?from=${event.date}&to=${event.date}&label=${encodeURIComponent(event.label)}`}
              aria-label={`${event.label}, ${formatSignedDollars(display.displayAmount)} on ${formatShortDate(event.date)}. View transactions`}
              className="block h-full"
            >
              <Card className="flex h-full min-h-24 flex-col justify-between gap-1 p-2.5 transition-colors hover:border-border-strong sm:min-h-28 sm:p-4">
                <span
                  aria-hidden
                  className={`flex size-7 items-center justify-center rounded-full sm:size-9 ${
                    positive ? "bg-positive-muted text-positive" : "bg-negative-muted text-negative"
                  }`}
                >
                  {display.buildsEquity ? <PiggyBank size={15} /> : <Icon size={15} />}
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
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
