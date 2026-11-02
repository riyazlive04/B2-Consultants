import {
  SkeletonMetricCards,
  SkeletonPageHeader,
  SkeletonTable,
  SkeletonTabs,
} from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="w-full space-y-6">
      <SkeletonPageHeader />
      <SkeletonMetricCards count={4} />
      <SkeletonTabs />
      <SkeletonTable />
    </div>
  );
}
