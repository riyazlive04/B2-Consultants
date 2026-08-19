"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { SECTION_CATALOGUE } from "@/lib/sections";

/**
 * Which sections this viewer can actually reach - available to any client component that wants
 * to render a link into one (Error Log O2).
 *
 * The sidebar already hides a removed section, but the rest of the app kept linking into it:
 * KPI cards, "View all" actions and alert rows all carry hard-coded hrefs. With Finance switched
 * off, five links on the home page alone still pointed at `/finance`, and every one of them
 * bounced to `/?denied=finance`. A dead link that throws you back where you started IS the
 * "empty shell" the spec says must not survive - arguably worse than a missing feature, because
 * it looks like the app is broken rather than like the section is off.
 *
 * Held as a Set of first path segments rather than full hrefs, so a deep link (`/students/123`,
 * `/agreements/new`) resolves to its owning section without every caller having to know that.
 */

const SectionAccessContext = createContext<Set<string> | null>(null);

/** First path segment of an href: "/students/123?tab=x" → "students". */
function rootOf(href: string): string {
  return href.split("?")[0].split("#")[0].split("/").filter(Boolean)[0] ?? "";
}

/** Every route that IS a section - so a link to a non-section route is never gated. */
const SECTION_ROOTS = new Set(SECTION_CATALOGUE.map((s) => rootOf(s.href)));

export function SectionAccessProvider({
  hrefs,
  children,
}: {
  /** The viewer's visible section hrefs, already filtered server-side by `visibleSections`. */
  hrefs: string[];
  children: ReactNode;
}) {
  const roots = useMemo(() => new Set(hrefs.map(rootOf)), [hrefs]);
  return <SectionAccessContext.Provider value={roots}>{children}</SectionAccessContext.Provider>;
}

/**
 * Can this viewer follow `href`?
 *
 * Fails OPEN in two cases, both deliberate:
 *   • no provider (a component rendered outside the app shell) - gating on absent data would
 *     silently strip links from screens that never opted into this;
 *   • the target is not a section route at all (`/profile`, an external URL, an anchor).
 *
 * Only a link into a KNOWN section that the viewer does NOT have is refused.
 */
export function useCanNavigate(href: string | undefined | null): boolean {
  const roots = useContext(SectionAccessContext);
  if (!href) return false;
  if (!roots) return true;
  const root = rootOf(href);
  if (!SECTION_ROOTS.has(root)) return true;
  return roots.has(root);
}
