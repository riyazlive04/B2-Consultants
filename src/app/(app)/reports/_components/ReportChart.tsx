"use client";

import { BarChart3, LineChart } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/kit";
import { RankedBars, TimeSeriesChart, type RankedRow } from "@/components/ui/chart";
import { compactInrMinor, compactNumber, rollUpLongTail, seriesColor } from "@/lib/chart";
import { formatInrMinor, formatPct } from "@/lib/format";
import {
  chartShapeFor,
  groupByLabel,
  measureIsAdditive,
  measureLabel,
  measurePrevValue,
  measureValue,
  objectLabel,
  type ReportMeasure,
  type ReportObject,
  type ReportResult,
} from "@/lib/reports";

/**
 * The picture of the current report.
 *
 * The chart FORM is chosen by data shape, not by a picker (`chartShapeFor`) — see §5.8 and the
 * rationale on that function. Giving the user a chart-type dropdown sounds like flexibility and
 * in practice hands them the chance to plot a ranking as a line, which asserts continuity between
 * categories that have none. The tool should know which chart answers the question it was just
 * asked.
 *
 * Long tails roll up to a "Other" bar: a 40-bar chart is a texture, not a ranking. Nothing is
 * hidden — the table below always carries every row.
 */

const CHART_ROW_LIMIT = 12;

export default function ReportChart({
  object,
  groupBy,
  measure,
  result,
  compareLabel,
  periodLabel,
}: {
  object: ReportObject;
  groupBy: string;
  measure: ReportMeasure;
  result: ReportResult;
  /** e.g. "vs previous 90 days". Empty on All time, where there is nothing to compare. */
  compareLabel: string;
  periodLabel: string;
}) {
  const shape = chartShapeFor(groupBy, result.rows.length);
  const groupLabel = groupByLabel(object, groupBy).toLowerCase();
  const mLabel = measureLabel(object, measure);

  // Money is the only measure whose axis and tooltip should format differently: the axis wants
  // "₹3.5L" to stay narrow, the tooltip wants the real grouped figure (§3).
  const isMoney = measure === "value";
  const axisFormat = (v: number) =>
    isMoney ? compactInrMinor(v) : measure === "winRate" ? `${Math.round(v)}%` : compactNumber(v);
  const fullFormat = (v: number) =>
    isMoney ? formatInrMinor(v) : measure === "winRate" ? formatPct(v) : v.toLocaleString("en-IN");

  const hasCompare = compareLabel !== "";
  const title = (
    <CardTitle icon={shape === "bars" ? <BarChart3 size={17} /> : <LineChart size={17} />}>
      {mLabel} by {groupLabel}
    </CardTitle>
  );

  // ── trend: an ordered axis, so the shape over time IS the message ──
  if (shape !== "bars") {
    const points = result.rows.map((r) => ({ label: shortMonth(r.label), fullLabel: r.label }));
    const series = [
      {
        key: "current",
        label: periodLabel,
        color: seriesColor(0),
        values: result.rows.map((r) => measureValue(r, measure)),
      },
      ...(hasCompare
        ? [
            {
              key: "previous",
              label: "Previous period",
              color: "var(--ink-3)",
              compare: true,
              values: result.rows.map((r) => measurePrevValue(r, measure)),
            },
          ]
        : []),
    ];

    return (
      <Card title={title} subtitle={`${periodLabel}${hasCompare ? ` · ${compareLabel}` : ""}`}>
        <TimeSeriesChart
          points={points}
          series={series}
          mode={shape === "column" ? "column" : "line"}
          height={280}
          formatValue={axisFormat}
          formatTooltip={fullFormat}
          // A rate is not a quantity — baselining a win rate at zero wastes most of the plot on
          // empty space below a line that lives between 20% and 60%.
          zeroBased={measure !== "winRate"}
          srCaption={`${mLabel} of ${objectLabel(object)} by ${groupLabel}, ${periodLabel}`}
          emptyTitle="No records in this period"
          emptyBody="Widen the period, or pick a different object."
          footnote={
            hasCompare
              ? "The dashed line is the equivalent stretch immediately before this period, aligned to the most recent bucket."
              : undefined
          }
        />
      </Card>
    );
  }

  // ── ranking: named categories, long labels, "which is biggest and is it growing?" ──
  const additive = measureIsAdditive(measure);
  const ranked: RankedRow[] = result.rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: measureValue(r, measure),
    display: fullFormat(measureValue(r, measure)),
    compareValue: hasCompare ? measurePrevValue(r, measure) : undefined,
    compareDisplay: hasCompare
      ? (() => {
          const p = measurePrevValue(r, measure);
          return p == null ? undefined : fullFormat(p);
        })()
      : undefined,
    href: r.href,
    // Count is the volume behind a money or rate figure — without it "100% win rate" off one
    // deal reads identically to 100% off forty, which is the single most common way a rate
    // misleads.
    meta: measure !== "count" ? `${r.count.toLocaleString("en-IN")} record${r.count === 1 ? "" : "s"}` : undefined,
  }));

  const rows = rollUpLongTail(ranked, CHART_ROW_LIMIT, (value, count) => ({
    key: "__other",
    label: `Other (${count} groups)`,
    value,
    display: fullFormat(value),
    color: "var(--ink-3)",
  }));

  return (
    <Card title={title} subtitle={`${periodLabel}${hasCompare ? ` · ${compareLabel}` : ""}`}>
      <RankedBars
        rows={rows}
        // Share only means something for a measure that sums. A "share of total win rate" is a
        // confident nonsense number.
        showShare={additive}
        compareLabel={hasCompare ? compareLabel : undefined}
        srCaption={`${mLabel} of ${objectLabel(object)} by ${groupLabel}, ${periodLabel}`}
        emptyTitle="No records in this period"
        emptyBody="Widen the period, or pick a different object."
        footnote={
          result.rows.some((r) => r.href)
            ? "Rows link through to the filtered list behind the number."
            : undefined
        }
      />
    </Card>
  );
}

/** "July 2026" → "Jul 26" for a crowded axis; the tooltip keeps the full label. */
function shortMonth(label: string): string {
  const m = label.match(/^(\w{3})\w*\s+(\d{4})$/);
  return m ? `${m[1]} ${m[2].slice(2)}` : label;
}
