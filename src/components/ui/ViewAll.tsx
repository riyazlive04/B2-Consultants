"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useCanNavigate } from "@/components/shell/SectionAccess";

/**
 * The "View all →" action beside a section heading.
 *
 * Lives in its own file rather than in `kit.tsx` because it needs a hook, and `kit.tsx` is
 * imported by server components — putting `"use client"` on the whole kit would drag Card,
 * PageHeader and every other primitive across the boundary with it. `kit.tsx` re-exports this
 * one, so every existing `import { ViewAll } from "@/components/ui/kit"` keeps working.
 *
 * Renders NOTHING when the target section is switched off for this viewer (Error Log O2). A
 * "View all" that lands on `/?denied=` looks like the app is broken; no link at all correctly
 * says the section simply isn't there.
 */
export function ViewAll({ href, children = "View all" }: { href: string; children?: ReactNode }) {
  const canNavigate = useCanNavigate(href);
  if (!canNavigate) return null;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-field px-2.5 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft"
    >
      {children}
      <ArrowRight size={15} className="flex-none" />
    </Link>
  );
}
