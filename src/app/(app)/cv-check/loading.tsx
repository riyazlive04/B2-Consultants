import { SkeletonBlock, SkeletonCard, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** CV Studio: header → saved-resume rail beside the builder/review pane. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading CV Studio">
      <SkeletonPageHeader />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-14 rounded-btn" delay={i * 60} />
          ))}
        </div>
        <SkeletonCard bodyHeight="h-96" />
      </div>
    </div>
  );
}
