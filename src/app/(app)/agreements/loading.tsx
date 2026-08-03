import { SkeletonPageHeader, SkeletonMetricCards, SkeletonTable } from "@/components/ui/Skeleton";

/** Agreements: header → the derived-state stat tiles → the agreements table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading agreements">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
