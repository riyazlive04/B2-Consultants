import { SkeletonBlock, SkeletonPageHeader, SkeletonTabs } from "@/components/ui/Skeleton";

/** Conversations: header → channel tabs → thread list beside the message pane. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading conversations">
      <SkeletonPageHeader />
      <SkeletonTabs count={3} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
        {/* thread list */}
        <div className="space-y-2 rounded-card border border-line bg-surface p-3 shadow-card">
          {Array.from({ length: 7 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-16 rounded-btn" delay={i * 60} />
          ))}
        </div>
        {/* message pane */}
        <div className="rounded-card border border-line bg-surface p-4 shadow-card">
          <SkeletonBlock className="h-12 w-64" />
          <SkeletonBlock className="mt-4 h-72 w-full" delay={80} />
          <SkeletonBlock className="mt-4 h-12 w-full rounded-field" delay={160} />
        </div>
      </div>
    </div>
  );
}
