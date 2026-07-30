import {
  SkeletonBlock,
  SkeletonCard,
  SkeletonMetricCards,
  SkeletonPageHeader,
  SkeletonTable,
} from "@/components/ui/Skeleton";

/**
 * Reports streams a shell immediately instead of painting blank: the report query is a
 * full-table aggregate over two windows and stalls a beat on a 23k-row CRM.
 *
 * The shape MUST track the real page or the skeleton stops being free — it starts costing
 * layout shift. Updated with the workbench rebuild: the controls card is now a four-field
 * grid rather than a single strip, there is a chart between the KPI row and the table, and
 * the summary is a four-up MetricCard row, not three bare stat panels.
 */
export default function Loading() {
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-label="Loading reports">
      <SkeletonPageHeader />

      {/* controls: object · period · group by · measure */}
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <SkeletonBlock className="h-3 w-20" delay={i * 50} />
              <SkeletonBlock className="h-10 w-full max-w-sm rounded-field" delay={i * 50 + 40} />
            </div>
          ))}
        </div>
      </div>

      <SkeletonMetricCards count={4} />
      <SkeletonCard bodyHeight="h-72" />
      <SkeletonTable rows={8} cols={4} />
    </div>
  );
}
