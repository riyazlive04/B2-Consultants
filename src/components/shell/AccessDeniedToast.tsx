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
  // StrictMode double-invokes effects in dev; without this the toast fires twice.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!denied || shown.current === denied) return;
    shown.current = denied;

    const what =
      denied === "admin"
        ? "That section is admin-only."
        : `You don't have access to ${denied.replace(/[.-]/g, " ")}.`;
    toast(what, "error");

    router.replace(pathname);
  }, [denied, pathname, router]);

  return null;
}
