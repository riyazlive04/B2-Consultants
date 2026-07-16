import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import {
  GROUP_BY_FIELDS,
  REPORT_OBJECTS,
  defaultGroupBy,
  isValidObject,
  type ReportObject,
} from "@/lib/reports";
import { getReport } from "@/server/reports-metrics";
import ReportControls from "./_components/ReportControls";
import ReportTable from "./_components/ReportTable";

export const dynamic = "force-dynamic";

/**
 * The minimal pivot report (BUILD_CHECKLIST §10 / PRODUCT_AUDIT §15): pick an object, a group-by
 * field, see counts / sums / win-rate. Closes the audit's headline gap — "every number lives on a
 * page an engineer had to write, there is no way to ask the data an ad hoc question" — without any
 * new schema, by making the whole query URL-driven (?object=…&groupBy=…) rather than a new
 * hardcoded page per question. That also makes a report shareable: the URL *is* the saved report.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { object?: string; groupBy?: string };
}) {
  await requireSection("reports");

  const object: ReportObject = isValidObject(searchParams.object) ? searchParams.object : "opportunities";
  const { groupBy, result } = await getReport(object, searchParams.groupBy ?? defaultGroupBy(object));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<BarChart3 size={22} strokeWidth={1.8} />}
        eyebrow="Insights"
        title="Reports"
        subtitle="Pick an object, group it by a field that matters, and see counts, totals and win rate — no new page required. The link below is the saved report."
      />
      <ReportControls object={object} groupBy={groupBy} fields={GROUP_BY_FIELDS[object]} objects={REPORT_OBJECTS} />
      <ReportTable object={object} groupBy={groupBy} result={result} />
    </div>
  );
}
