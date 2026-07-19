import Link from "next/link";
import { branding } from "@/lib/config/branding";

interface LegalPageProps {
  title: string;
  version: string;
  children: React.ReactNode;
}

/** Shared frame for legal documents: title, version stamp, draft banner. */
export function LegalPage({ title, version, children }: LegalPageProps) {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-primary">{title}</h1>
        <p className="mt-1 text-sm text-secondary">
          {branding.productName} · Version {version} · Effective {version}
        </p>
        <p className="mt-3 rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-secondary" role="note">
          Draft pending legal review. This document reflects our real commitments but has not yet
          been reviewed by a lawyer.
        </p>
      </header>
      <div className="flex flex-col gap-5 text-sm leading-relaxed text-secondary [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-primary">
        {children}
      </div>
      <footer className="mt-8 text-sm">
        <Link href="/login" className="text-primary underline underline-offset-4">
          Back to sign in
        </Link>
      </footer>
    </article>
  );
}
