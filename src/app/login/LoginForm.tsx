"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { signInWithPassword, type AuthFormState } from "@/app/actions/auth";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signInWithPassword,
    {},
  );
  const [status, setStatus] = useState<"idle" | "authenticating">("idle");
  const [hashError, setHashError] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const linkError = params.get("error");

  // Implicit-flow magic links land here with tokens in the hash fragment
  // (e.g. dev links from admin.generateLink). The PKCE-defaulted browser
  // client ignores hash tokens, so establish the session explicitly.
  // Production PKCE links (?code=...) go through /auth/callback instead
  // and never hit this path.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const hashParams = new URLSearchParams(hash.slice(1));
    const clearHash = () =>
      window.history.replaceState(null, "", window.location.pathname + window.location.search);

    const errorDescription = hashParams.get("error_description");
    if (errorDescription) {
      // One-time read of a client-only API (location.hash) that cannot be
      // computed during render; not the derived-state anti-pattern this
      // rule targets.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHashError(errorDescription.replace(/\+/g, " "));
      clearHash();
      return;
    }
    const access_token = hashParams.get("access_token");
    const refresh_token = hashParams.get("refresh_token");
    if (!access_token || !refresh_token) return;

    setStatus("authenticating");
    const supabase = createClient();
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      clearHash();
      if (error) {
        setStatus("idle");
        setHashError("That sign-in link expired or was invalid. Try again.");
        return;
      }
      // router.replace() alone already fetches a fresh RSC payload for the
      // destination; a same-tick router.refresh() call was found (live e2e
      // testing) to make the App Router drop the server's pending
      // NEXT_REDIRECT to /onboarding, leaving the user stuck on /login.
      router.replace("/");
    });
  }, [router]);

  if (status === "authenticating") {
    return (
      <Card className="p-6">
        <p className="text-sm text-primary" role="status">
          Signing you in…
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="identifier" className="text-sm font-medium text-primary">
          Email or username
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          required
          autoComplete="username"
          placeholder="you@example.com or IslandBuilder"
          className={inputCls}
        />
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="text-sm font-medium text-primary">
            Password
          </label>
          <Link
            href="/auth/reset"
            className="text-xs text-secondary underline underline-offset-4 hover:text-primary"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput id="password" name="password" required autoComplete="current-password" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {(state.error || linkError || hashError) && (
          <p className="text-sm text-negative" role="alert">
            {hashError ??
              state.error ??
              "That sign-in link expired or was invalid. Try again."}
          </p>
        )}
      </form>
      <p className="mt-4 text-center text-sm text-secondary">
        New here?{" "}
        <Link href="/signup" className="text-primary underline underline-offset-4">
          Create account
        </Link>
      </p>
      <p className="mt-3 text-center text-xs text-tertiary">
        <Link href="/terms" className="underline underline-offset-4 hover:text-secondary">
          Terms of Service
        </Link>
        {" · "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-secondary">
          Privacy Policy
        </Link>
      </p>
    </Card>
  );
}
