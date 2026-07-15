"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const params = useSearchParams();
  const linkError = params.get("error");

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
          {(status === "error" || linkError) && (
            <p className="text-sm text-negative" role="alert">
              {linkError ? "That sign-in link expired or was invalid. Try again." : "Could not send the link. Check the address and try again."}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
