/**
 * Shared skeleton primitives.
 *
 * All of these render the `.skeleton` shimmer from globals.css, which already
 * respects `prefers-reduced-motion` (the animation flattens to a static fill).
 * Shapes here deliberately mirror the real components they stand in for —
 * MetricCard, DataTable, Card — so the swap to real content doesn't jump.
 *
 * Every block is decorative: the wrapper carries `aria-busy` + a label, and the
 * blocks themselves are hidden from the accessibility tree.
 */

export function SkeletonBlock({
  className = "",
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <div
      aria-hidden
      className={`skeleton ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}

/** Page title block: eyebrow → title → subtitle, matching PageHeader. */
export function SkeletonPageHeader() {
  return (
    <div className="flex items-center gap-4">
      <SkeletonBlock className="h-11 w-11 flex-none rounded-btn" />
      <div className="min-w-0 flex-1 space-y-2">
        <SkeletonBlock className="h-7 w-56 max-w-full" />
        <SkeletonBlock className="h-4 w-96 max-w-full" delay={80} />
      </div>
    </div>
  );
}

/** A row of stat tiles — mirrors the MetricCard grid used across the app. */
export function SkeletonMetricCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-8 w-8 flex-none rounded-btn" delay={i * 60} />
            <SkeletonBlock className="h-3 w-24" delay={i * 60} />
          </div>
          <SkeletonBlock className="mt-3 h-8 w-28" delay={i * 60 + 40} />
          <SkeletonBlock className="mt-2 h-3 w-20" delay={i * 60 + 80} />
        </div>
      ))}
    </div>
  );
}

/** A card shell with an optional title bar — mirrors <Card>. */
export function SkeletonCard({
  className = "",
  bodyHeight = "h-40",
  withTitle = true,
}: {
  className?: string;
  bodyHeight?: string;
  withTitle?: boolean;
}) {
  return (
    <div className={`rounded-card border border-line bg-surface shadow-card ${className}`}>
      {withTitle && (
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="h-4 w-16" delay={60} />
        </div>
      )}
      <div className="p-4">
        <SkeletonBlock className={`w-full ${bodyHeight}`} delay={80} />
      </div>
    </div>
  );
}

/** Table shell — toolbar, header row, then striped body rows (mirrors DataTable). */
export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {/* toolbar: filter box + record count + export */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-1 items-center gap-3">
          <SkeletonBlock className="h-10 w-full max-w-64 rounded-field" />
          <SkeletonBlock className="h-3 w-16" delay={60} />
        </div>
        <SkeletonBlock className="h-10 w-28 rounded-btn" delay={120} />
      </div>
      {/* header */}
      <div className="hidden gap-4 border-b border-line px-4 py-3 tab:flex">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBlock key={i} className="h-3 flex-1" delay={i * 40} />
        ))}
      </div>
      {/* body */}
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonBlock key={c} className="h-4 flex-1" delay={r * 50 + c * 25} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tab strip placeholder. */
export function SkeletonTabs({ count = 2 }: { count?: number }) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} className="h-10 w-40 rounded-btn" delay={i * 60} />
      ))}
    </div>
  );
}

/** Top-bar pill (runway badge / bell) while its data streams in. */
export function SkeletonPill({ className = "w-36" }: { className?: string }) {
  return <SkeletonBlock className={`h-10 rounded-full ${className}`} />;
}

/**
 * Standard section page: header → stat tiles → table.
 * Used as the default route fallback; sections with a distinct shape ship their
 * own loading.tsx instead of using this.
 */
export function SkeletonSectionPage({
  metrics = 4,
  rows = 6,
  cols = 5,
}: {
  metrics?: number;
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={metrics} />
      <SkeletonTable rows={rows} cols={cols} />
    </div>
  );
}
