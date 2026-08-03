import { SkeletonCard, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** Profile: header → identity/avatar card → preference + password cards. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading profile">
      <SkeletonPageHeader />
      <SkeletonCard bodyHeight="h-40" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonCard bodyHeight="h-32" />
        <SkeletonCard bodyHeight="h-32" />
      </div>
    </div>
  );
}
