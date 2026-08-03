import { SkeletonBlock, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** Automation: ListHeader → folder rail beside the workflow list. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading automation">
      <SkeletonPageHeader />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_1fr]">
        <div className="space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-9 rounded-btn" delay={i * 60} />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-20 rounded-card" delay={i * 70} />
          ))}
        </div>
      </div>
    </div>
  );
}
