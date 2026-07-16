import { SkeletonBlock, SkeletonMetricCards, SkeletonTable, SkeletonTabs } from "@/components/ui/Skeleton";

/** Payments: invoices / estimates / products / subscriptions — tiles then a list. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading payments">
      <div className="flex items-center justify-between gap-3">
        <SkeletonBlock className="h-8 w-40" />
        <SkeletonBlock className="h-10 w-32 rounded-btn" delay={60} />
      </div>
      <SkeletonMetricCards count={4} />
      <SkeletonTabs count={4} />
      <SkeletonTable rows={8} cols={6} />
    </div>
  );
}
