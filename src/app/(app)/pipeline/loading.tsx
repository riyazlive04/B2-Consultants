import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonMetricCards,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonTabs,
} from "@/components/ui/Skeleton";

/** Pipeline: header → target bar → hero bento → metric tiles → tabbed tables. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading pipeline">
      <SkeletonPageHeader />

      {/* monthly revenue target bar */}
      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between">
          <SkeletonBlock className="h-4 w-48" />
          <SkeletonBlock className="h-5 w-56" delay={60} />
        </div>
        <SkeletonBlock className="mt-4 h-3 w-full rounded-full" delay={100} />
        <SkeletonBlock className="mt-2 h-3 w-64" delay={140} />
      </div>

      {/* hero bento: pipeline value · calls completed · won this month */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonCard bodyHeight="h-28" withTitle={false} />
        <SkeletonCard bodyHeight="h-28" withTitle={false} />
        <SkeletonCard bodyHeight="h-28" withTitle={false} />
      </div>

      <SkeletonMetricCards count={4} />
      <SkeletonTabs count={2} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
