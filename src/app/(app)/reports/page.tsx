import { BarChart3, Megaphone } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import {
  GROUP_BY_FIELDS,
  REPORT_OBJECTS,
  defaultGroupBy,
  defaultMeasure,
  isValidMeasure,
  isValidObject,
  parseReportRange,
  resolveReportRange,
  type ReportObject,
} from "@/lib/reports";
import { getReport } from "@/server/reports-metrics";
import { getAttribution } from "@/server/insights-metrics";
import ReportControls from "./_components/ReportControls";
import ReportSummary from "./_components/ReportSummary";
import ReportChart from "./_components/ReportChart";
import ReportTable from "./_components/ReportTable";
import AttributionTable from "./_components/AttributionTable";

export const dynamic = "force-dynamic";

/** What the money column means, per object — the same sum answers a different question each time. */
const SUM_LABEL: Record<ReportObject, string> = {
  contacts: "Total",
  opportunities: "Pipeline value",
  invoices: "Total amount",
};

/**
 * The Reports workbench (BUILD_CHECKLIST §10 / PRODUCT_AUDIT §15).
 *
 * Closes the audit's headline gap — *"every number lives on a page an engineer had to write,
 * there is no way to ask the data an ad hoc question"* — with no new schema, by making the whole
 * query URL-driven (`?object=&groupBy=&measure=&range=`) rather than a new hardcoded page per
 * question. The URL *is* the saved report.
 *
 * The page answers four questions, in the order a founder asks them:
 *   1. **How much, and is it moving?**  → ReportSummary — totals with period-on-period deltas.
 *   2. **Which of these matters most?** → ReportChart — ranked bars, or a trend when the grouping
 *                                        is chronological. The form is chosen by data shape, never
 *                                        by a chart-type dropdown (§5.8).
 *   3. **Exactly what is in there?**    → ReportTable — every row, every measure, sortable, CSV.
 *   4. **What did each campaign cost?** → AttributionTable — spend → lead → enrolment economics.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { object?: string; groupBy?: string; measure?: string; range?: string };
}) {
  await requireSection("reports");

  const object: ReportObject = isValidObject(searchParams.object) ? searchParams.object : "opportunities";
  const measure = isValidMeasure(object, searchParams.measure)
    ? searchParams.measure
    : defaultMeasure(object);

  // The upper bound is the real instant, not IST midnight: a report that silently excludes
  // everything logged today is wrong in exactly the way nobody thinks to check.
  const range = resolveReportRange(parseReportRange(searchParams.range), new Date());

  const [{ groupBy, result }, attribution] = await Promise.all([
    getReport(object, searchParams.groupBy ?? defaultGroupBy(object), measure, range),
    // Attribution now follows the same period control as everything else on the page. It was
    // hardcoded to 90 days, which meant the picker moved every figure on the page except this one.
    getAttribution(range.from ?? new Date(0), range.to),
  ]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<BarChart3 size={22} strokeWidth={1.8} />}
        eyebrow="Insights"
        title="Reports"
        subtitle="Pick an object, a period, and a field that matters — see how much, which way it is moving, and what sits behind the number. The link is the saved report."
      />

      <ReportControls
        object={object}
        groupBy={groupBy}
        measure={measure}
        range={range.key}
        fields={GROUP_BY_FIELDS[object]}
        objects={REPORT_OBJECTS}
      />

      <ReportSummary
        object={object}
        result={result}
        compareLabel={range.compareLabel}
        sumLabel={SUM_LABEL[object]}
      />

      <ReportChart
        object={object}
        groupBy={groupBy}
        measure={measure}
        result={result}
        compareLabel={range.compareLabel}
        periodLabel={range.label}
      />

      <ReportTable
        object={object}
        groupBy={groupBy}
        result={result}
        compareLabel={range.compareLabel}
        sumLabel={SUM_LABEL[object]}
      />

      {/*
        ER v2 Track F. The diagram's INSIGHT entity, computed rather than stored — every field
        of it is a division over rows that already exist, so a table would just be a cached
        quotient that goes stale the moment a lead converts.
      */}
      <section className="space-y-4">
        <SectionHeading
          icon={<Megaphone size={18} />}
          title="Campaign attribution"
          description={`What each campaign cost per lead and per enrolled student — ${range.label.toLowerCase()}.`}
        />
        <AttributionTable rows={attribution} />
      </section>
    </div>
  );
}
