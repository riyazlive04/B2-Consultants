"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { SECTION_CATALOGUE } from "@/lib/sections";

/**
 * "HOW DOES THIS SCREEN WORK?" - one click from any screen to its manual.
 *
 * The manuals live at /guide/<section>, and a manual nobody can find from the screen it describes
 * gets read once, during onboarding, and never again. So the top bar maps wherever you are to the
 * section that owns it - the longest catalogue href that prefixes the path, so /payments/new
 * answers to Payments - and links straight there.
 *
 * Hidden on the guide itself, on the home screen (which is no one section), and for anyone whose
 * founder has switched the guide off for them.
 */
export function ScreenGuideButton({ accessibleHrefs }: { accessibleHrefs: string[] }) {
  const pathname = usePathname() ?? "/";
  if (!accessibleHrefs.includes("/guide") || pathname.startsWith("/guide")) return null;

  const owner = SECTION_CATALOGUE.filter((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  if (!owner) return null;

  return (
    <Link
      href={`/guide/${owner.key}`}
      title={`How ${owner.label} works`}
      aria-label={`How ${owner.label} works - open its guide`}
      className="press hidden h-10 w-10 flex-none place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink sm:grid"
    >
      <CircleHelp size={18} />
    </Link>
  );
}
