"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PASSWORD_MIN } from "@/lib/validation/auth";
import { updatePassword, type AuthFormState } from "@/app/actions/auth";

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    updatePassword,
    {},
  );

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="password" className="text-sm font-medium text-primary">
          New password
        </label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={PASSWORD_MIN}
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-tertiary">
          At least {PASSWORD_MIN} characters.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save password"}
        </button>
        {state.error && (
          <p className="text-sm text-negative" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </Card>
  );
}
