import { SkeletonMetricCards, SkeletonPageHeader, SkeletonTable, SkeletonTabs } from "@/components/ui/Skeleton";

/**
 * Outreach streams a shell instead of painting blank: the page fans out six reads
 * (queue, metrics, users, closed, config, WATI) and had no loading.tsx. Header → the
 * four KPI cards → the Queue / Key Metrics / Closed tabs → the queue table.
 */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading outreach">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTabs count={3} />
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
