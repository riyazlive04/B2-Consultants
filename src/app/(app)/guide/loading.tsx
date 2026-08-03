import { SkeletonCard, SkeletonPageHeader } from "@/components/ui/Skeleton";

/** App Guide: header → the stacked explainer cards. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading app guide">
      <SkeletonPageHeader />
      {[0, 1, 2].map((i) => (
        <SkeletonCard key={i} bodyHeight="h-32" />
      ))}
    </div>
  );
}
