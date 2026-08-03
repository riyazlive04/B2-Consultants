import { SkeletonBlock, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** Arena: header → podium → the ranked leaderboard rows. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading arena">
      <SkeletonPageHeader />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonBlock key={i} className="h-36 rounded-card" delay={i * 70} />
        ))}
      </div>
      <div className="space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-12 rounded-btn" delay={i * 50} />
        ))}
      </div>
    </div>
  );
}
