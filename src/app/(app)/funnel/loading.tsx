import { SkeletonBlock, SkeletonCard, SkeletonPageHeader, SkeletonTable } from "@/components/ui/Skeleton";


/** Conversion Funnel: header → drop-off alert → narrowing funnel → metrics table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading conversion funnel">
      <SkeletonPageHeader />
      {/* biggest drop-off alert box */}
      <SkeletonBlock className="h-20 w-full" />
      {/* the five narrowing funnel blocks */}
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <div className="flex flex-col items-center gap-2">
          {[100, 78, 56, 38, 22].map((w, i) => (
            <div
              key={w}
              aria-hidden
              className="skeleton h-12"
              style={{ width: `${w}%`, minWidth: "11rem", animationDelay: `${i * 90}ms` }}
            />
          ))}
        </div>
      </div>
      <SkeletonTable rows={9} cols={5} />
      <SkeletonCard bodyHeight="h-32" />
    </div>
  );
}
