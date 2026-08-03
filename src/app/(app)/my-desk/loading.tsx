import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonMetricCards,
  SkeletonPageHeader,
} from "@/components/ui/Skeleton";

/**
 * My Desk had no loading state at all, while pipeline, outreach, contacts, cash and finance all
 * did — so it was the one screen that showed a blank page until every query resolved. On the
 * pooled Supabase connection that is the whole difference between "loading" and "broken" to the
 * person waiting, and it is the screen a caller opens most.
 *
 * Shaped for the queue-first L1 desk (the common case): the priority queue is the page, so the
 * skeleton leads with a list, not with metric tiles.
 */
export default function Loading() {
  return (
    <div className="w-full space-y-8" aria-busy="true" aria-label="Loading your desk">
      <SkeletonPageHeader />

      {/* The priority queue — two buckets' worth of rows. */}
      <section className="space-y-4">
        <SkeletonBlock className="h-5 w-44" />
        {[0, 1].map((card) => (
          <div key={card} className="rounded-card border border-line bg-surface p-4 shadow-card">
            <SkeletonBlock className="h-4 w-56" delay={card * 80} />
            <div className="mt-4 space-y-3">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <SkeletonBlock className="h-4 w-40" delay={card * 80 + row * 40} />
                    <SkeletonBlock className="h-3 w-56" delay={card * 80 + row * 40 + 20} />
                  </div>
                  <SkeletonBlock className="h-8 w-20 flex-none rounded-btn" delay={card * 80 + row * 40} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Tomorrow's calls. */}
      <section className="space-y-4">
        <SkeletonBlock className="h-5 w-52" />
        <SkeletonMetricCards count={3} />
      </section>

      {/* Targets. */}
      <section className="space-y-4">
        <SkeletonBlock className="h-5 w-32" />
        <SkeletonCard bodyHeight="h-56" withTitle={false} />
      </section>
    </div>
  );
}
