import { SkeletonCard, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** A section's manual: header → the contents rail beside the stacked feature cards. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading the manual">
      <SkeletonPageHeader />
      <div className="grid gap-6 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <SkeletonCard bodyHeight="h-40" />
        <div className="space-y-6">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} bodyHeight="h-56" />
          ))}
        </div>
      </div>
    </div>
  );
}
