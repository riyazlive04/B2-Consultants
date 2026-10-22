"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSignature, FileStack, Users } from "lucide-react";

/**
 * Section navigation for Agreements.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
 * Templates and bulk sending were reachable only as two small buttons in the header of the
 * agreements LIST - so from a template screen, or from an agreement, there was no way back to
 * either except the browser's back button. Three screens that belong to one job were effectively
 * three dead ends.
 *
 * Links, not tabs: each is a real page with its own URL, and a tab control that navigates is a
 * link wearing the wrong clothes. `aria-current="page"` is what actually announces the position -
 * the colour is a reinforcement of it, never the only signal.
 */

const ITEMS = [
  { href: "/agreements", label: "Agreements", icon: FileSignature, exact: false },
  { href: "/agreements/templates", label: "Templates", icon: FileStack, exact: false },
  { href: "/agreements/bulk", label: "Send in bulk", icon: Users, exact: true },
] as const;

export function AgreementNav() {
  const pathname = usePathname() ?? "";

  /**
   * The most specific match wins. Every path starts with `/agreements`, so a plain `startsWith`
   * would light up "Agreements" on the templates screen as well - which is worse than no
   * highlight, because it says you are somewhere you are not.
   */
  const active =
    ITEMS.map((i) => i.href)
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0] ?? "/agreements";

  return (
    <nav aria-label="Agreements" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 px-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const current = href === active;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex h-9 items-center gap-1.5 rounded-btn px-3 text-sm font-medium transition-colors ${
                  current
                    ? "bg-primary-soft text-primary"
                    : "text-ink-2 hover:bg-surface-2 hover:text-primary"
                }`}
              >
                <Icon size={15} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
