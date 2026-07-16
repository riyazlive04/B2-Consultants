import { SkeletonBlock } from "@/components/ui/Skeleton";

/** Opportunities: the drag-drop kanban board — header bar, then stage columns. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading opportunities">
      <div className="flex items-center justify-between gap-3">
        <SkeletonBlock className="h-8 w-48" />
        <SkeletonBlock className="h-10 w-36 rounded-btn" delay={60} />
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="w-72 flex-none space-y-3">
            <SkeletonBlock className="h-9 w-full rounded-btn" delay={col * 70} />
            {Array.from({ length: 3 }).map((_, card) => (
              <SkeletonBlock
                key={card}
                className="h-24 w-full rounded-card"
                delay={col * 70 + card * 60}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
