import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { RequestResetForm } from "./RequestResetForm";

export const metadata: Metadata = { title: `Reset password — ${branding.productName}` };

export default function ResetRequestPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">Reset your password</h1>
        <p className="mt-1 text-sm text-secondary">
          We&rsquo;ll email you a link to set a new one.
        </p>
      </header>
      <RequestResetForm />
    </div>
  );
}
