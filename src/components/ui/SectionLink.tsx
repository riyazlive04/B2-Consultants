"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCanNavigate } from "@/components/shell/SectionAccess";

/**
 * A link into another SECTION, which renders nothing when the viewer cannot open it.
 *
 * Exists because some sections are reachable but not listed on the sidebar (`offRail`) - the
 * Opportunities board and the Outreach queue are surfaced from Pipeline, where they belong,
 * rather than as three separate rail entries for one job. Those cross-links are now the ONLY way
 * in, so they must be right about access: a dead link into a section someone lacks is worse than
 * the extra rail entry it replaced.
 *
 * `useCanNavigate` fails OPEN outside the app shell and for non-section routes, so this is safe
 * to use anywhere; only a link into a known section the viewer does not hold is dropped.
 */
export function SectionLink({
  href,
  sectionKey: _sectionKey,
  children,
}: {
  href: string;
  /** Documentation for the reader - access is resolved from `href`'s first path segment. */
  sectionKey: string;
  children: ReactNode;
}) {
  const allowed = useCanNavigate(href);
  if (!allowed) return null;

  return (
    <Link
      href={href}
      className="inline-flex h-9 flex-none items-center gap-1.5 rounded-field border border-line bg-surface px-3 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}
