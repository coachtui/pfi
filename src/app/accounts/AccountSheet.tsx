"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { InlineError } from "@/components/ui/InlineError";
import { createAccount, deleteAccount, updateAccount } from "@/app/actions/accounts";
import {
  accountSchema,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  type AccountFormValues,
} from "@/lib/validation/transactions";
import type { AccountSummary } from "@/lib/data/mappers";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";
const labelCls = "text-sm font-medium text-primary";

export function AccountSheet({
  account,
  open,
  onClose,
  onDeleted,
}: {
  account: AccountSummary | null;
  open: boolean;
  onClose: () => void;
  onDeleted?: (warning?: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: account
      ? {
          displayName: account.displayName,
          type: account.type,
          institution: account.institution ?? undefined,
          currentBalance: account.currentBalance ?? 0,
          creditLimit: account.creditLimit ?? undefined,
          interestRate: account.interestRate ?? undefined,
        }
      : { type: "checking", currentBalance: 0 },
  });
  const type = watch("type");

  const submit = (values: AccountFormValues) => {
    setServerError(null);
    setWarning(null);
    startTransition(async () => {
      const result = account
        ? await updateAccount({ ...values, id: account.id })
        : await createAccount(values);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      if (result.warning) setWarning(result.warning);
      reset();
      router.refresh();
      if (!result.warning) onClose();
    });
  };

  const remove = () => {
    if (!account) return;
    setServerError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await deleteAccount(account.id);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      router.refresh();
      onDeleted?.(result.warning);
      if (!onDeleted) onClose();
    });
  };

  const optionalNumber = { setValueAs: (v: string) => (v === "" ? undefined : Number(v)) };

  return (
    <Sheet open={open} onClose={onClose} title={account ? "Edit account" : "Add account"}>
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-3">
        <label className={labelCls} htmlFor="acct-name">
          Name
        </label>
        <input
          id="acct-name"
          className={inputCls}
          placeholder="House Checking"
          {...register("displayName")}
        />
        {errors.displayName && (
          <p role="alert" className="text-xs text-negative">
            {errors.displayName.message}
          </p>
        )}

        <label className={labelCls} htmlFor="acct-type">
          Type
        </label>
        <select id="acct-type" className={inputCls} {...register("type")}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        <label className={labelCls} htmlFor="acct-institution">
          Institution (optional)
        </label>
        <input
          id="acct-institution"
          className={inputCls}
          placeholder="Pacific Bank"
          {...register("institution", { setValueAs: (v) => (v === "" ? undefined : v) })}
        />

        <label className={labelCls} htmlFor="acct-balance">
          Current balance ($)
        </label>
        <input
          id="acct-balance"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          className={inputCls}
          {...register("currentBalance", { valueAsNumber: true })}
        />
        <p className="text-xs text-tertiary">
          Enter today’s balance. For loans and cards, enter the amount owed as a positive number.
        </p>
        {errors.currentBalance && (
          <p role="alert" className="text-xs text-negative">
            {errors.currentBalance.message}
          </p>
        )}

        {type === "credit_card" && (
          <>
            <label className={labelCls} htmlFor="acct-limit">
              Credit limit ($, optional)
            </label>
            <input
              id="acct-limit"
              type="number"
              step="1"
              min="0"
              inputMode="decimal"
              className={inputCls}
              {...register("creditLimit", optionalNumber)}
            />
          </>
        )}
        {(type === "credit_card" ||
          type === "mortgage" ||
          type === "auto_loan" ||
          type === "student_loan" ||
          type === "personal_loan") && (
          <>
            <label className={labelCls} htmlFor="acct-rate">
              Interest rate (%, optional)
            </label>
            <input
              id="acct-rate"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              className={inputCls}
              {...register("interestRate", optionalNumber)}
            />
          </>
        )}

        {serverError && (
          <InlineError message={serverError} />
        )}
        {warning && (
          <p role="status" className="text-sm text-warning">
            ⚠ {warning}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60"
        >
          {pending ? "Saving…" : account ? "Save changes" : "Add account"}
        </button>

        {account && (
          <div className="mt-3 border-t border-border-subtle pt-4">
            {!confirmingDelete ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-negative px-3 py-2 text-sm font-medium text-negative transition-colors hover:bg-negative/10 disabled:opacity-60"
              >
                <Trash2 size={16} aria-hidden /> Delete account
              </button>
            ) : (
              <div className="flex flex-col gap-3" role="alert">
                <p className="text-sm font-medium text-primary">
                  Delete {account.displayName} and all of its transactions and balance history?
                </p>
                <p className="text-xs text-secondary">
                  This cannot be undone. Archive the account instead if you may need its history
                  later.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-secondary hover:text-primary disabled:opacity-60"
                  >
                    Keep account
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={remove}
                    className="rounded-lg bg-negative px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {pending ? "Deleting…" : "Delete account and data"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </form>
    </Sheet>
  );
}
