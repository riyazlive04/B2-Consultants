import { SkeletonBlock, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** Funnels: ListHeader → the grid of funnel cards. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading funnels">
      <SkeletonPageHeader />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-40 rounded-card" delay={i * 70} />
        ))}
      </div>
    </div>
  );
}
