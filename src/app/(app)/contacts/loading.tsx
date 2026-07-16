import { SkeletonBlock, SkeletonTable } from "@/components/ui/Skeleton";

/** Contacts: Synamate-parity list page — edge-to-edge header bar, then the table. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading contacts">
      <div className="flex items-center justify-between gap-3">
        <SkeletonBlock className="h-8 w-40" />
        <div className="flex gap-2">
          <SkeletonBlock className="h-10 w-28 rounded-btn" delay={60} />
          <SkeletonBlock className="h-10 w-32 rounded-btn" delay={120} />
        </div>
      </div>
      <SkeletonTable rows={10} cols={6} />
    </div>
  );
}
