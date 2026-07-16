"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";

/** Error boundary for the Console surface — admin/money config must never fail to a blank screen. */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16">
      <Card className="w-full">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-bad-soft text-bad">
            <AlertTriangle size={28} />
          </span>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink">Console couldn’t load</h1>
          <p className="max-w-sm text-sm text-muted">
            We hit a problem loading the console. No settings were changed — try again, and if it keeps
            happening, refresh the page.
          </p>
          {process.env.NODE_ENV === "development" && error?.message && (
            <pre className="max-w-full overflow-x-auto rounded-field bg-surface-2 px-3 py-2 text-left text-xs text-ink-2">
              {error.message}
            </pre>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Btn variant="primary" onClick={reset}>
              Try again
            </Btn>
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-btn px-4 text-sm font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
