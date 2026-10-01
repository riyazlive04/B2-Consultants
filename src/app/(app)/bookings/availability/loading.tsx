import { SkeletonCard, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** Availability: header → the three editor cards → the upcoming-slots list. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading availability">
      <SkeletonPageHeader />
      <SkeletonCard bodyHeight="h-48" />
      <SkeletonCard bodyHeight="h-96" />
      <SkeletonCard bodyHeight="h-40" />
    </div>
  );
}
