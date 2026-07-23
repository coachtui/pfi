"use client";

import { useState } from "react";
import { BadgeCheck, Pencil, TreePalm } from "lucide-react";
import { CompanyEmblem } from "@/components/dashboard/CompanyEmblem";
import { CompanyProfileSheet } from "@/components/dashboard/CompanyProfileSheet";

interface CompanyHeaderProps {
  companyName: string;
  ticker: string;
  username: string;
  logoPath: string | null;
  level?: number;
}

/** Personal-company identity block. The whole left block is a single button
 *  that opens the edit sheet; a visually-hidden <h1> preserves the heading
 *  outline (a heading nested inside a button would lose its heading role). */
export function CompanyHeader({ companyName, ticker, username, logoPath, level }: CompanyHeaderProps) {
  const [editing, setEditing] = useState(false);
  return (
    <header className="flex items-center justify-between">
      <h1 className="sr-only">{companyName}</h1>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit company profile — verified data coverage"
        className="flex items-center gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
      >
        <CompanyEmblem logoPath={logoPath} />
        <span className="block">
          <span className="flex items-center gap-1.5 text-lg leading-tight font-semibold text-primary">
            {companyName}
            <Pencil size={13} aria-hidden className="text-tertiary" />
          </span>
          <span className="tabular block text-sm font-medium text-positive">{ticker}</span>
          <span className="flex items-center gap-1 text-xs text-secondary">
            {username}
            <BadgeCheck size={13} aria-hidden className="text-positive" />
          </span>
        </span>
      </button>
      {level !== undefined && (
        <span className="relative flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-positive/30 via-elevated-2 to-[color:var(--chart-waterline)]/20 text-positive">
          <TreePalm size={22} aria-hidden />
          <span className="absolute -bottom-1 rounded-full border border-border-subtle bg-elevated px-1.5 text-[9px] font-semibold text-secondary">
            LV. {level}
          </span>
          <span className="sr-only">Level {level}</span>
        </span>
      )}
      <CompanyProfileSheet
        open={editing}
        onClose={() => setEditing(false)}
        initial={{ companyName, ticker, username, logoPath }}
      />
    </header>
  );
}
