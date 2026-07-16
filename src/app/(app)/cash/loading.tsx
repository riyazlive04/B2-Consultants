import { SkeletonCard, SkeletonMetricCards, SkeletonPageHeader, SkeletonTable } from "@/components/ui/Skeleton";

/** Cash Health: header → four-number summary → 12-week chart → payables/receivables. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading cash health">
      <SkeletonPageHeader />
      {/* summary card: cash · receivables · payables due · runway (PRD3 §4.5) */}
      <SkeletonMetricCards count={4} />
      {/* 12-week bank-balance line chart */}
      <SkeletonCard bodyHeight="h-56" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonTable rows={5} cols={4} />
        <SkeletonTable rows={5} cols={4} />
      </div>
    </div>
  );
}
