import { SkeletonMetricCards, SkeletonPageHeader, SkeletonBlock } from "@/components/ui/Skeleton";

/**
 * Default route-transition skeleton for any section without its own loading.tsx —
 * mirrors the standard section layout (header → hero → cards). Sections with a
 * distinct shape (finance, pipeline, students, …) ship a closer-fitting one.
 */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading">
      <SkeletonPageHeader />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SkeletonBlock className="h-64 lg:col-span-2" />
        <SkeletonBlock className="h-64" delay={80} />
      </div>
      <SkeletonMetricCards count={3} />
    </div>
  );
}
