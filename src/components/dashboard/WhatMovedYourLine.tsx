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
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
              <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-border-strong">
                <span
                  aria-hidden
                  className={`flex size-9 items-center justify-center rounded-full ${
                    positive ? "bg-positive-muted text-positive" : "bg-negative-muted text-negative"
                  }`}
                >
                  {display.buildsEquity ? <PiggyBank size={18} /> : <Icon size={18} />}
                </span>
                <p className="text-sm font-medium text-primary">{event.label}</p>
                <p
                  className={`tabular text-sm font-semibold ${
                    positive ? "text-positive" : "text-negative"
                  }`}
                >
                  {formatSignedDollars(display.displayAmount)}
                </p>
                <p className="text-xs text-tertiary">{formatShortDate(event.date)}</p>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
