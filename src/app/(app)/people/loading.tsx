import { SkeletonBlock, SkeletonPageHeader, SkeletonTable, SkeletonTabs } from "@/components/ui/Skeleton";

/** People: header → tabs → today's log status chips → weekly/monthly rollups → log table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading people">
      <SkeletonPageHeader />
      <SkeletonTabs count={4} />

      {/* today's submission chips */}
      <div className="space-y-3">
        <SkeletonBlock className="h-6 w-24" />
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-14 w-52 rounded-card" delay={i * 70} />
          ))}
        </div>
      </div>

      {/* weekly + monthly rollup cards, one per member */}
      {[0, 1].map((block) => (
        <div key={block} className="space-y-3">
          <SkeletonBlock className="h-6 w-36" delay={block * 60} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-44 rounded-card" delay={block * 60 + i * 70} />
            ))}
          </div>
        </div>
      ))}

      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
