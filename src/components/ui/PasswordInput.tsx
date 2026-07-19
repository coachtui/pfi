"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Password field with a show/hide toggle. The toggle is a real button
 * (keyboard focusable, aria-pressed, explicit label) and flipping it never
 * moves focus or clears the value.
 */
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={
          className ??
          "w-full rounded-xl border border-border-subtle bg-inset px-4 py-3 pr-12 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none"
        }
        {...props}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-tertiary hover:text-primary focus:outline-none focus-visible:text-primary"
      >
        {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  );
}
