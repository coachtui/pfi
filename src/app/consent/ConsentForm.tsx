"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { acceptAgreements, type AuthFormState } from "@/app/actions/auth";

export function ConsentForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    () => acceptAgreements(),
    {},
  );

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-3">
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
          {pending ? "Saving…" : "Agree and continue"}
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
