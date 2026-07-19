"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PASSWORD_MIN } from "@/lib/validation/auth";
import { signUpWithPassword, type AuthFormState } from "@/app/actions/auth";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signUpWithPassword,
    {},
  );

  if (state.message) {
    return (
      <Card className="p-6">
        <p className="text-sm text-primary" role="status">
          {state.message}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
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
        <label htmlFor="password" className="text-sm font-medium text-primary">
          Password
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
        <label className="flex items-start gap-3 text-sm text-secondary">
          <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-current" />
          <span>
            I&rsquo;ve read and agree to the{" "}
            <Link href="/terms" target="_blank" className="text-primary underline underline-offset-4">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="text-primary underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
        {state.error && (
          <p className="text-sm text-negative" role="alert">
            {state.error}
          </p>
        )}
      </form>
      <p className="mt-4 text-center text-sm text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
