import { SkeletonCard, SkeletonPageHeader, SkeletonTabs } from "@/components/ui/Skeleton";

/** Founder Console: header → the settings tab strip → stacked config panels. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading founder console">
      <SkeletonPageHeader />
      <SkeletonTabs count={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonCard bodyHeight="h-48" />
        <SkeletonCard bodyHeight="h-48" />
        <SkeletonCard bodyHeight="h-32" />
        <SkeletonCard bodyHeight="h-32" />
      </div>
    </div>
  );
}
