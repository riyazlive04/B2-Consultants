import { SkeletonPageHeader, SkeletonTable, SkeletonTabs } from "@/components/ui/Skeleton";

/** Activity Log: header → actor/section filter tabs → the who-did-what-when table. */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading activity log">
      <SkeletonPageHeader />
      <SkeletonTabs count={3} />
      <SkeletonTable rows={10} cols={5} />
    </div>
  );
}
