"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/components/ui/feedback";

/**
 * `rbac.ts` bounces an unauthorised page load to `/?denied=<key>`. Without this,
 * the person lands on the dashboard with no explanation and cannot tell a
 * permissions boundary from a bug.
 *
 * Announced via the toast layer (role="status", aria-live="polite"), then the
 * query param is stripped so a refresh or a shared URL doesn't replay it.
 */
export function AccessDeniedToast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const denied = params.get("denied");
  const kind = params.get("kind");
  // StrictMode double-invokes effects in dev; without this the toast fires twice.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!denied || shown.current === denied) return;
    shown.current = denied;

    const what =
      denied === "admin"
        ? "That section is admin-only."
        : // `kind=personal` (rbac.ts): a self-scoped student page, not a permission we withheld.
          // Keyed off the param rather than a list of keys here, so the two can't drift.
          kind === "personal"
          ? "That page is a student's own - it reads their classes and progress from their login. Open the person on the Students board instead."
          : `You don't have access to ${denied.replace(/[.-]/g, " ")}.`;
    // The toast layer has only success/error, so the wording carries the distinction.
    toast(what, "error");

    router.replace(pathname);
  }, [denied, kind, pathname, router]);

  return null;
}
