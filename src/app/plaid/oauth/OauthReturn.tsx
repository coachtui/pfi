"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleX, Hourglass, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { clearLinkSession, readLinkSession, saveLinkResult, type LinkResult, type LinkSession } from "@/app/accounts/link-session";
import { usePfiPlaidLink } from "@/app/accounts/usePfiPlaidLink";

type Phase = { kind: "loading" } | { kind: "resume"; session: LinkSession; returnUrl: string } | { kind: "expired" } | { kind: "error"; message: string };

export function OauthReturn() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  // One-time read of client-only APIs (sessionStorage, location) after mount;
  // not the derived-state anti-pattern the set-state-in-effect rule targets.
  useEffect(() => {
    const session = readLinkSession(window.sessionStorage);
    // Plaid always returns with an oauth_state_id; a bare visit is a stale bookmark.
    const returned = /[?#]/.test(window.location.href);
    if (session && !returned) clearLinkSession(window.sessionStorage);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase(session && returned ? { kind: "resume", session, returnUrl: window.location.href } : { kind: "expired" });
  }, []);

  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center">
      <Card className="flex flex-col gap-3 p-5" data-testid="plaid-oauth-return">
        {phase.kind === "loading" && <Status icon={<Hourglass size={16} aria-hidden />} text="Finishing your bank sign-in…" />}
        {phase.kind === "resume" && (
          <ResumeLink session={phase.session} returnUrl={phase.returnUrl} onError={(message) => setPhase({ kind: "error", message })} />
        )}
        {phase.kind === "expired" && (
          <>
            <Status icon={<TriangleAlert size={16} aria-hidden />} text="This bank sign-in has expired." />
            <p className="text-xs text-secondary">Bank sign-ins have to finish within 30 minutes. Start again from Accounts.</p>
            <BackLink />
          </>
        )}
        {phase.kind === "error" && (
          <>
            <Status icon={<CircleX size={16} aria-hidden />} text={phase.message} />
            <BackLink />
          </>
        )}
      </Card>
    </div>
  );
}

function Status({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm font-medium text-primary">
      <span className="text-secondary">{icon}</span> {text}
    </p>
  );
}

function BackLink() {
  return (
    <Link href="/accounts" className="inline-block rounded-xl border border-border-subtle px-4 py-2 text-center text-sm font-semibold text-primary">
      Back to Accounts
    </Link>
  );
}

/** Mounted only once a session exists: re-initializes Link at the redirect URI and hands the result to the card. */
function ResumeLink({ session, returnUrl, onError }: { session: LinkSession; returnUrl: string; onError: (message: string) => void }) {
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const { busy } = usePfiPlaidLink({
    resume: session,
    receivedRedirectUri: returnUrl,
    onResult: (result: LinkResult) => {
      if (!result.ok) { onError(result.message); return; }
      saveLinkResult(window.sessionStorage, result);
      setFinishing(true);
      router.replace("/accounts");
    },
    onCancel: () => router.replace("/accounts"),
  });
  const text = busy === "connect" ? "Connecting your accounts…" : busy && busy !== "link" ? "Syncing…" : finishing ? "Done — taking you back to Accounts…" : "Finishing your bank sign-in…";
  return <Status icon={<Hourglass size={16} aria-hidden />} text={text} />;
}
