import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: `Create account — ${branding.productName}` };

export default function SignupPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">{branding.productName}</h1>
        <p className="mt-1 text-sm text-secondary">{branding.tagline}</p>
      </header>
      <SignupForm />
      <p className="text-center text-xs text-tertiary">
        {branding.productName} is an educational analytics tool, not financial advice.
      </p>
    </div>
  );
}
