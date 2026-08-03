import { SkeletonCard, SkeletonMetricCards, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** My Journey: header → progress tiles → the student's timeline card. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading my journey">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={3} />
      <SkeletonCard bodyHeight="h-64" />
    </div>
  );
}
