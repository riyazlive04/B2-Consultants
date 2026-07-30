"use client";

import { Coins, Layers, Rows3, Trophy } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import { pctChange } from "@/lib/chart";
import { formatInrMinor, formatPct } from "@/lib/format";
import { objectLabel, type ReportObject, type ReportResult } from "@/lib/reports";

/**
 * The three-second read, above the chart.
 *
 * Each tile carries its own change against the previous period, because a total without a
 * direction is not a decision — "23,434 contacts" is a fact the founder already knows; "23,434,
 * down 31% on the previous 90 days" is the thing worth opening the page for.
 *
 * `positiveIsGood` is set per tile rather than assumed: more contacts is good, and so is a higher
 * win rate, but the colour has to follow the DECISION, not the arithmetic sign (§1.2). Every tile
 * here happens to be "up is good"; it is passed explicitly so the next tile added has to think
 * about it.
 */
export default function ReportSummary({
  object,
  result,
  compareLabel,
  sumLabel,
}: {
  object: ReportObject;
  result: ReportResult;
  /** Empty on All time, where there is no previous window. */
  compareLabel: string;
  sumLabel: string;
}) {
  const hasCompare = compareLabel !== "";

  /** A delta chip only when the comparison is both available and meaningful (§ pctChange). */
  const deltaFor = (current: number | null, previous: number | null | undefined) => {
    if (!hasCompare || current == null || previous == null) return undefined;
    const pct = pctChange(current, previous);
    return pct == null ? undefined : { pct, caption: compareLabel, positiveIsGood: true };
  };

  /** What to say when a delta is withheld, so a missing chip never reads as "no change". */
  const noCompareNote = (previous: number | null | undefined) =>
    !hasCompare
      ? "All time — nothing to compare against"
      : previous === 0 || previous == null
        ? "No records in the previous period"
        : undefined;

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label={`${objectLabel(object)} matched`}
        value={result.totalCount.toLocaleString("en-IN")}
        icon={<Rows3 size={18} />}
        delta={deltaFor(result.totalCount, result.prevTotalCount)}
        secondary={noCompareNote(result.prevTotalCount)}
        tooltip={`Records of this object created inside the selected period. Archived records are excluded everywhere in this report.`}
      />

      {result.totalSumMinor !== null && (
        <MetricCard
          label={sumLabel}
          value={formatInrMinor(result.totalSumMinor, { compact: true })}
          icon={<Coins size={18} />}
          delta={deltaFor(result.totalSumMinor, result.prevTotalSumMinor)}
          secondary={noCompareNote(result.prevTotalSumMinor) ?? formatInrMinor(result.totalSumMinor)}
          tooltip="The sum of the money field on every matched record. Opportunity value is the deal's own figure, not collected cash — Finance is where cash lives."
        />
      )}

      {result.overallWinRatePct !== null && (
        <MetricCard
          label="Overall win rate"
          value={formatPct(result.overallWinRatePct)}
          icon={<Trophy size={18} />}
          delta={deltaFor(result.overallWinRatePct, result.prevOverallWinRatePct)}
          secondary={noCompareNote(result.prevOverallWinRatePct)}
          tooltip="Won ÷ all matched opportunities in the period. Read it beside the count — a 100% win rate off one deal and off forty are the same number and very different facts."
        />
      )}

      <MetricCard
        label="Groups"
        value={result.rows.length.toLocaleString("en-IN")}
        icon={<Layers size={18} />}
        secondary={
          result.chronological
            ? "Periods on the chart, including empty ones"
            : "Distinct values of the group-by field"
        }
        tooltip="How many buckets this grouping produced. A grouping with one bucket is telling you the field is empty on almost every record."
      />
    </div>
  );
}
