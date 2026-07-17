"use client";

import { useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ParsedCsv } from "@/lib/csv-import/types";
import { parseCsv } from "@/lib/csv-import/parse";
import { AccountSheet } from "@/app/accounts/AccountSheet";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

const selectCls =
  "w-full rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary focus:border-border-strong focus:outline-none";

export function UploadStep({
  accounts,
  accountId,
  onAccountChange,
  onReady,
}: {
  accounts: AccountSummary[];
  accountId: string;
  onAccountChange: (id: string) => void;
  onReady: (parsed: ParsedCsv, fileName: string) => void;
}) {
  const [error, setError] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    if (!/\.csv$/i.test(file.name)) {
      setError("Choose a .csv file — bank sites usually offer one under Export or Download.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is over 5 MB. Export a shorter date range and try again.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.headers.length === 0) {
      setError("That file looks empty — no header row or data found.");
      return;
    }
    if (parsed.rows.length === 0) {
      setError("The file has a header but no data rows.");
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      setError(`That file has ${parsed.rows.length.toLocaleString()} rows (max 10,000). Export a shorter date range.`);
      return;
    }
    onReady(parsed, file.name);
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <label htmlFor="import-account" className="mb-1 block text-sm font-medium text-primary">
          Import into which account?
        </label>
        <p className="mb-2 text-xs text-secondary">
          One CSV holds one account&apos;s transactions — pick where these belong.
        </p>
        <select
          id="import-account"
          value={accountId}
          onChange={(e) => onAccountChange(e.target.value)}
          className={selectCls}
        >
          <option value="">Choose an account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAddingAccount(true)}
          className="mt-2 inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"
        >
          <Plus size={16} aria-hidden /> New account
        </button>
      </div>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          id="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <button
          type="button"
          disabled={!accountId}
          onClick={() => inputRef.current?.click()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
        >
          <Upload size={18} aria-hidden /> Choose CSV file
        </button>
        {!accountId && <p className="mt-1 text-xs text-secondary">Pick an account first.</p>}
        {error && <p role="alert" className="mt-2 text-sm text-negative">✕ {error}</p>}
        <p className="mt-3 text-xs text-tertiary">
          Your file is read on this device. Only the transactions you approve in the preview are saved.
        </p>
      </div>

      <AccountSheet account={null} open={addingAccount} onClose={() => setAddingAccount(false)} />
    </section>
  );
}
