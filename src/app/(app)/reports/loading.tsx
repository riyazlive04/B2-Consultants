import { SkeletonBlock, SkeletonPageHeader, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * Reports streams a shell immediately instead of painting blank: the report query is a
 * full-table aggregate that stalls a beat on a large CRM, and there was no loading.tsx —
 * so the whole screen was white until it resolved. Header → controls row → the three
 * summary stats → the pivot table, matching the real layout to keep CLS ~0.
 */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading reports">
      <SkeletonPageHeader />
      {/* object / group-by controls */}
      <SkeletonBlock className="h-11 w-full max-w-lg rounded-card" />
      {/* the three summary stat panels */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonBlock key={i} className="h-24 rounded-card" delay={i * 70} />
        ))}
      </div>
      <SkeletonTable rows={8} cols={4} />
    </div>
  );
}
