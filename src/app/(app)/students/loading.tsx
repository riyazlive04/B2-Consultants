import {
  SkeletonBlock,
  SkeletonMetricCards,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonTabs,
} from "@/components/ui/Skeleton";

/** Students: header → two rows of count/LTV tiles → LTV strip → tabbed tracker table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading students">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonMetricCards count={4} />
      {/* "Average LTV: Solo … Guided … Elite … Upgrade rate" strip */}
      <SkeletonBlock className="h-4 w-[36rem] max-w-full" />
      <SkeletonTabs count={2} />
      <SkeletonTable rows={8} cols={7} />
    </div>
  );
}
