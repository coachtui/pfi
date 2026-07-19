"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { requestPasswordReset, type AuthFormState } from "@/app/actions/auth";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";

export function RequestResetForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    requestPasswordReset,
    {},
  );

  return (
    <Card className="p-6">
      {state.message ? (
        <p className="text-sm text-primary" role="status">
          {state.message}
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium text-primary">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className={inputCls}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
          >
            {pending ? "Sending…" : "Email me a reset link"}
          </button>
          {state.error && (
            <p className="text-sm text-negative" role="alert">
              {state.error}
            </p>
          )}
        </form>
      )}
      <p className="mt-4 text-center text-sm text-secondary">
        <Link href="/login" className="text-primary underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
