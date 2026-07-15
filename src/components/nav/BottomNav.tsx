"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, Home, Trophy } from "lucide-react";

const tabs = [
  { href: "/", label: "Home", icon: Home },
  { href: "/rankings", label: "Rankings", icon: Trophy },
  { href: "/data", label: "Data", icon: BarChart3 },
  { href: "/report", label: "Report", icon: FileText },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border-subtle bg-base/90 backdrop-blur-md"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 rounded-lg px-4 py-1 text-xs transition-colors ${
                  active ? "text-positive" : "text-secondary hover:text-primary"
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                <span>{label}</span>
                <span
                  aria-hidden
                  className={`h-0.5 w-6 rounded-full ${active ? "bg-positive" : "bg-transparent"}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
