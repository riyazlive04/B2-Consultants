import { BarChart3, Megaphone } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/ui/kit";
import { canOpenSection, requireSection } from "@/lib/rbac";
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
import { getReport, type ReportScope } from "@/server/reports-metrics";
import { getAttribution } from "@/server/insights-metrics";
import ReportControls from "./_components/ReportControls";
import ReportSummary from "./_components/ReportSummary";
import ReportChart from "./_components/ReportChart";
import ReportTable from "./_components/ReportTable";
import AttributionTable from "./_components/AttributionTable";

/** Its own name in the browser tab, rather than sharing one title with every other page
 *  (issue 28). The root layout adds the "· B2 Consultants" suffix. */
export const metadata = { title: "Reports" };

export const dynamic = "force-dynamic";

/** What the money column means, per object - the same sum answers a different question each time. */
const SUM_LABEL: Record<ReportObject, string> = {
  contacts: "Total",
  opportunities: "Pipeline value",
  invoices: "Total amount",
};

/**
 * The Reports workbench (BUILD_CHECKLIST §10 / PRODUCT_AUDIT §15).
 *
 * Closes the audit's headline gap - *"every number lives on a page an engineer had to write,
 * there is no way to ask the data an ad hoc question"* - with no new schema, by making the whole
 * query URL-driven (`?object=&groupBy=&measure=&range=`) rather than a new hardcoded page per
 * question. The URL *is* the saved report.
 *
 * The page answers four questions, in the order a founder asks them:
 *   1. **How much, and is it moving?**  → ReportSummary - totals with period-on-period deltas.
 *   2. **Which of these matters most?** → ReportChart - ranked bars, or a trend when the grouping
 *                                        is chronological. The form is chosen by data shape, never
 *                                        by a chart-type dropdown (§5.8).
 *   3. **Exactly what is in there?**    → ReportTable - every row, every measure, sortable, CSV.
 *   4. **What did each campaign cost?** → AttributionTable - spend → lead → enrolment economics.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { object?: string; groupBy?: string; measure?: string; range?: string };
}) {
  const session = await requireSection("reports");

  /**
   * ── WHAT THIS VIEWER MAY REPORT ON ───────────────────────────────────────────────────────────
   *
   * Opening Reports is not the same question as "may this person see the book's money". Invoice
   * totals and campaign economics (spend, cost per lead, cost to acquire) are Finance figures, so
   * they are offered only to someone who could open Finance - which is the founder by default.
   * Anyone else gets the two record objects, narrowed to their own leads and deals.
   *
   * Narrowed in the QUERY, not in the table: a total is the thing people read off this page, and
   * a filtered table under an unfiltered total is worse than either.
   */
  const canSeeMoney = await canOpenSection("finance", session.role, session.overrides);
  const scope: ReportScope = session.role === "ADMIN" ? null : { ownerId: session.user.id };
  const objects = canSeeMoney ? REPORT_OBJECTS : REPORT_OBJECTS.filter((o) => o.key !== "invoices");

  const requested: ReportObject = isValidObject(searchParams.object) ? searchParams.object : "opportunities";
  // A hand-edited or bookmarked `?object=invoices` must not be a way round the line above.
  const object: ReportObject = requested === "invoices" && !canSeeMoney ? "opportunities" : requested;
  const measure = isValidMeasure(object, searchParams.measure)
    ? searchParams.measure
    : defaultMeasure(object);

  // The upper bound is the real instant, not IST midnight: a report that silently excludes
  // everything logged today is wrong in exactly the way nobody thinks to check.
  const range = resolveReportRange(parseReportRange(searchParams.range), new Date());

  const [{ groupBy, result }, attribution] = await Promise.all([
    getReport(object, searchParams.groupBy ?? defaultGroupBy(object), measure, range, scope),
    // Attribution now follows the same period control as everything else on the page. It was
    // hardcoded to 90 days, which meant the picker moved every figure on the page except this one.
    canSeeMoney
      ? getAttribution(range.from ?? new Date(0), range.to)
      : Promise.resolve([] as Awaited<ReturnType<typeof getAttribution>>),
  ]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<BarChart3 size={22} strokeWidth={1.8} />}
        eyebrow="Insights"
        title="Reports"
        subtitle={
          scope
            ? "Your own leads and deals: pick a period and a field that matters, and see which way it is moving. The link is the saved report."
            : "Pick an object, a period, and a field that matters - see how much, which way it is moving, and what sits behind the number. The link is the saved report."
        }
      />

      <ReportControls
        object={object}
        groupBy={groupBy}
        measure={measure}
        range={range.key}
        fields={GROUP_BY_FIELDS[object]}
        objects={objects}
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
        ER v2 Track F. The diagram's INSIGHT entity, computed rather than stored - every field
        of it is a division over rows that already exist, so a table would just be a cached
        quotient that goes stale the moment a lead converts.

        Finance-visible viewers only: every column of it is money (spend, cost per lead, cost to
        acquire, return on spend) over the whole business, and there is no per-owner version of it.
      */}
      {canSeeMoney && (
      <section className="space-y-4">
        <SectionHeading
          icon={<Megaphone size={18} />}
          title="Campaign attribution"
          description={`What each campaign cost per lead and per enrolled student - ${range.label.toLowerCase()}.`}
        />
        <AttributionTable rows={attribution} />
      </section>
      )}
    </div>
  );
}
