import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="flex items-center gap-1.5 text-xs text-tertiary transition-colors hover:text-primary"
      >
        <LogOut size={13} aria-hidden />
        Sign out
      </button>
    </form>
  );
}
