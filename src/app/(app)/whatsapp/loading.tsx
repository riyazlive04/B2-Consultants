import {
  SkeletonMetricCards,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonTabs,
} from "@/components/ui/Skeleton";

/** WhatsApp: header → delivery stat tiles → template/log tabs → message table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading WhatsApp">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTabs count={3} />
      <SkeletonTable rows={8} cols={5} />
    </div>
  );
}
