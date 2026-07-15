import type { ReactNode } from "react";

/** Elevated surface primitive. All dashboard cards share this treatment. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-card border border-border-subtle bg-elevated shadow-card ${className}`}
    >
      {children}
    </div>
  );
}
