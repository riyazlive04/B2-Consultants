import { SkeletonMetricCards, SkeletonPageHeader, SkeletonTable } from "@/components/ui/Skeleton";

/** Telecaller Pay: header → commission stat tiles → the per-caller payout table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading telecaller pay">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
