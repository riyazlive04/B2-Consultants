import {
  SkeletonMetricCards,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonTabs,
} from "@/components/ui/Skeleton";

/** Bookings: header → booking stat tiles → Requests / Slots / SSS tabs → table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading bookings">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTabs count={3} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
