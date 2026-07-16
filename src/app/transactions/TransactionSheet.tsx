"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sheet } from "@/components/ui/Sheet";
import { createTransaction, deleteTransaction, overrideTransaction } from "@/app/actions/transactions";
import {
  createTransactionSchema, type TransactionFormValues,
} from "@/lib/validation/transactions";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/config/categories";
import { formatDollars, formatShortDate } from "@/lib/financial-engine/format";
import type { AccountSummary, TransactionListItem } from "@/lib/data/mappers";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";
const labelCls = "text-sm font-medium text-primary";

function ResultNotice({ warning, error }: { warning: string | null; error: string | null }) {
  if (error) return <p role="alert" className="text-sm text-negative">✕ {error}</p>;
  if (warning) return <p role="status" className="text-sm text-warning">⚠ {warning}</p>;
  return null;
}

export function AddTransactionSheet({
  accounts,
  open,
  onClose,
}: {
  accounts: AccountSummary[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      postedDate: new Date().toISOString().slice(0, 10),
      direction: "outflow",
    },
  });

  const submit = (values: TransactionFormValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createTransaction(values);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      reset();
      onClose();
      router.refresh();
      if (result.warning) setServerError(null); // warning surfaces via dashboard stale notice
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add transaction">
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-3">
        <label className={labelCls} htmlFor="txn-account">Account</label>
        <select id="txn-account" className={inputCls} {...register("accountId")}>
          <option value="">Choose an account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
        {errors.accountId && <p role="alert" className="text-xs text-negative">Choose an account</p>}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="txn-date">Date</label>
            <input id="txn-date" type="date" className={inputCls} {...register("postedDate")} />
            {errors.postedDate && <p role="alert" className="text-xs text-negative">{errors.postedDate.message}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="txn-amount">Amount ($)</label>
            <input
              id="txn-amount" type="number" step="0.01" min="0" inputMode="decimal"
              className={inputCls} {...register("amount", { valueAsNumber: true })}
            />
            {errors.amount && <p role="alert" className="text-xs text-negative">{errors.amount.message}</p>}
          </div>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className={labelCls}>Direction</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="radio" value="outflow" {...register("direction")} /> Money out
            </label>
            <label className="flex items-center gap-2 text-sm text-primary">
              <input type="radio" value="inflow" {...register("direction")} /> Money in
            </label>
          </div>
        </fieldset>

        <label className={labelCls} htmlFor="txn-desc">Description</label>
        <input id="txn-desc" className={inputCls} placeholder="Groceries" {...register("description")} />
        {errors.description && <p role="alert" className="text-xs text-negative">{errors.description.message}</p>}

        <label className={labelCls} htmlFor="txn-category">Category (optional)</label>
        <select id="txn-category" className={inputCls} defaultValue="" {...register("category", { setValueAs: (v) => (v === "" ? undefined : v) })}>
          <option value="">Uncategorized</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>

        <label className={labelCls} htmlFor="txn-notes">Notes (optional)</label>
        <textarea id="txn-notes" rows={2} className={inputCls} {...register("notes", { setValueAs: (v) => (v === "" ? undefined : v) })} />

        <ResultNotice warning={null} error={serverError} />
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save transaction"}
        </button>
      </form>
    </Sheet>
  );
}

export function TransactionDetailSheet({
  txn,
  open,
  onClose,
}: {
  txn: TransactionListItem;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [category, setCategory] = useState<string>(txn.category ?? "");
  const [description, setDescription] = useState(txn.description);
  const [notes, setNotes] = useState(txn.notes ?? "");

  const inflow = txn.direction === "inflow";
  const changed =
    category !== (txn.category ?? "") || description !== txn.description || notes !== (txn.notes ?? "");

  const run = (fn: () => Promise<{ error: string; warning?: string }>, closeOnSuccess = true) => {
    setServerError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setServerError(result.error);
        return;
      }
      if (result.warning) setWarning(result.warning);
      router.refresh();
      if (closeOnSuccess && !result.warning) onClose();
    });
  };

  const save = () =>
    run(() =>
      overrideTransaction({
        id: txn.id,
        // Send a field only when the visible value differs from the current
        // effective one; "" category means clear the override.
        category: category !== (txn.category ?? "") ? (category === "" ? null : (category as Category)) : undefined,
        description: description !== txn.description ? description : undefined,
        notes: notes !== (txn.notes ?? "") ? notes || null : undefined,
      }),
    );

  const resetCorrections = () =>
    run(() => overrideTransaction({ id: txn.id, category: null, description: null }));

  return (
    <Sheet open={open} onClose={onClose} title="Transaction">
      <div className="flex flex-col gap-3">
        <div>
          <p className={`tabular text-2xl font-semibold ${inflow ? "text-positive" : "text-primary"}`}>
            {inflow ? "+" : "−"}{formatDollars(txn.amount)}
          </p>
          <p className="mt-1 text-xs text-tertiary">
            {txn.accountName} · {formatShortDate(txn.postedDate)} · {inflow ? "Money in" : "Money out"}
            {txn.isTransfer ? " · Transfer" : ""}
          </p>
          {txn.accountProvider !== "manual" && (
            <p className="mt-1 text-xs text-tertiary">
              Imported {txn.accountProvider} data — amount and date are locked; corrections below are tracked.
            </p>
          )}
          {txn.accountProvider === "manual" && (
            <p className="mt-1 text-xs text-tertiary">
              Wrong amount or date? Delete this transaction and re-add it.
            </p>
          )}
        </div>

        <label className={labelCls} htmlFor="detail-desc">Description</label>
        <input id="detail-desc" className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
        {txn.corrected && txn.original && (
          <p className="text-xs text-tertiary">
            Original: {txn.original.description}
            {txn.original.category ? ` · ${CATEGORY_LABELS[txn.original.category as Category] ?? txn.original.category}` : ""}
          </p>
        )}

        <label className={labelCls} htmlFor="detail-category">Category</label>
        <select id="detail-category" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Uncategorized</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>

        <label className={labelCls} htmlFor="detail-notes">Notes</label>
        <textarea id="detail-notes" rows={2} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <ResultNotice warning={warning} error={serverError} />

        <div className="mt-1 flex flex-col gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending || !changed}
            className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save corrections"}
          </button>
          {txn.corrected && (
            <button
              type="button"
              onClick={resetCorrections}
              disabled={pending}
              className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary hover:text-primary disabled:opacity-60"
            >
              Reset to original
            </button>
          )}
          {txn.accountProvider === "manual" &&
            (confirmingDelete ? (
              <button
                type="button"
                onClick={() => run(() => deleteTransaction(txn.id))}
                disabled={pending}
                className="rounded-xl border border-negative px-4 py-3 text-sm font-semibold text-negative disabled:opacity-60"
              >
                {pending ? "Deleting…" : "Confirm delete — can’t be undone"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending}
                className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary hover:text-primary"
              >
                Delete transaction
              </button>
            ))}
        </div>
      </div>
    </Sheet>
  );
}
