import type { ReactNode } from "react";

/**
 * Compact page header for the Synamate-parity list pages: a tight title band with an optional
 * soft count pill and right-aligned actions — denser than the icon-chip PageHeader, matching
 * GoHighLevel/Synamate's module layout. Uses B2 tokens (no new colours).
 */
export function ListHeader({
  title,
  count,
  subtitle,
  actions,
}: {
  title: string;
  count?: string | number;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="font-display text-h1 font-bold tracking-tight text-ink">{title}</h1>
        {count !== undefined && (
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-sm font-semibold text-primary-strong">
            {count}
          </span>
        )}
        {subtitle && <span className="hidden truncate text-sm text-muted sm:inline">· {subtitle}</span>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A thin toolbar band (search + filters + actions) that sits under the header/tabs, Synamate-style. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}
