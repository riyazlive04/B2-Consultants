import {
  SkeletonCard,
  SkeletonMetricCards,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonTabs,
} from "@/components/ui/Skeleton";

/** Finance: header → revenue hero + by-level bars → profit tiles → entry tables. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading finance">
      <SkeletonPageHeader />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonCard className="lg:col-span-2" bodyHeight="h-44" />
        <SkeletonCard bodyHeight="h-44" />
      </div>
      <SkeletonMetricCards count={4} />
      <SkeletonMetricCards count={3} />
      <SkeletonTabs count={3} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
