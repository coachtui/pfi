import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const metadata: Metadata = { title: `New password — ${branding.productName}` };

export default function UpdatePasswordPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">Set a new password</h1>
      </header>
      <UpdatePasswordForm />
    </div>
  );
}
