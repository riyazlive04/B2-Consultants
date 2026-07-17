import { SkeletonPageHeader, SkeletonMetricCards, SkeletonCard, SkeletonBlock } from "@/components/ui/Skeleton";

/** Route fallback for /daily-log: header → player strip → insight tiles → timeline cards. */
export default function DailyLogLoading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading your daily log">
      <SkeletonPageHeader />
      {/* player strip */}
      <SkeletonBlock className="h-20 w-full rounded-card" />
      {/* insight tiles */}
      <SkeletonMetricCards count={4} />
      {/* timeline */}
      <div className="space-y-3">
        <SkeletonBlock className="h-10 w-full max-w-72 rounded-field" />
        <SkeletonCard withTitle={false} bodyHeight="h-24" />
        <SkeletonCard withTitle={false} bodyHeight="h-24" />
        <SkeletonCard withTitle={false} bodyHeight="h-24" />
      </div>
    </div>
  );
}
