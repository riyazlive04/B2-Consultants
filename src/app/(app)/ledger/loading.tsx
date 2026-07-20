import { SkeletonMetricCards, SkeletonPageHeader, SkeletonTable } from "@/components/ui/Skeleton";

/**
 * Ledger streams a shell instead of a blank screen: the page runs a trial-balance +
 * audit-chain verify that isn't instant on a large journal, and had no loading.tsx.
 * Header → the four trial-balance stats → the journal table, matching the real layout.
 */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading ledger">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTable rows={10} cols={5} />
    </div>
  );
}
