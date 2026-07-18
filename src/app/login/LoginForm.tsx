"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error" | "authenticating">("idle");
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
      router.replace("/");
      router.refresh();
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setStatus(error ? "error" : "sent");
  }

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
      {status === "sent" ? (
        <p className="text-sm text-primary" role="status">
          Check your email — we sent a sign-in link to <span className="font-medium">{email}</span>.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium text-primary">
            Sign in with your email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {(status === "error" || linkError || hashError) && (
            <p className="text-sm text-negative" role="alert">
              {hashError ?? (linkError ? "That sign-in link expired or was invalid. Try again." : "Could not send the link. Check the address and try again.")}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
