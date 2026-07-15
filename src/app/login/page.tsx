import type { Metadata } from "next";
import { Suspense } from "react";
import { branding } from "@/lib/config/branding";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: `Sign in — ${branding.productName}` };

export default function LoginPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">{branding.productName}</h1>
        <p className="mt-1 text-sm text-secondary">{branding.tagline}</p>
      </header>
      <Suspense fallback={<div />}>
        <LoginForm />
      </Suspense>
      <p className="text-center text-xs text-tertiary">
        {branding.productName} is an educational analytics tool, not financial advice.
      </p>
    </div>
  );
}
