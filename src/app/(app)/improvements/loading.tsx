import { SkeletonMetricCards, SkeletonPageHeader, SkeletonTable, SkeletonTabs } from "@/components/ui/Skeleton";

/** Improvements: header → the four counts → filter bar → the queue. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading improvement reports">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTabs count={5} />
      <SkeletonTable rows={8} cols={7} />
    </div>
  );
}
