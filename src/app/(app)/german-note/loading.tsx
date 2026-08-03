import {
  SkeletonMetricCards,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonTabs,
} from "@/components/ui/Skeleton";

/** German Note: header → batch stat tiles → Batches / Workshops / P&L tabs → table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading German Note">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTabs count={3} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
