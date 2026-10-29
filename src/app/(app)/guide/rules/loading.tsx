import { SkeletonCard, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** Rules map: header → the filter box → the grouped rule lists. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading the rules map">
      <SkeletonPageHeader />
      {[0, 1, 2].map((i) => (
        <SkeletonCard key={i} bodyHeight="h-40" />
      ))}
    </div>
  );
}
