"use client";

import { TimeSeriesChart } from "@/components/ui/chart";
import { formatInrMinor } from "@/lib/format";
import type { AnnualPerformance } from "@/server/annual-metrics";

/**
 * Cumulative forecast vs actual (Error Log F1) — modelled on the client's own tracking sheet
 * ("Productivity / TCD Tracking", supplied as the reference screenshot).
 *
 * BARS, not lines. `AnnualChart` already plots the same two series as lines, and that is a
 * better read for trajectory — but the sheet the founder actually works from is a bar chart,
 * and the point of F1 is to replace that spreadsheet, not to offer a prettier alternative to
 * it. Both live on the page: bars for "where are we against plan", lines for "where is this
 * heading".
 *
 * Was hand-rolled SVG with every bar's value printed above it in 8px text — on a month where two
 * bars land close in height, or where a bar sits near one of the three reference lines, those
 * labels printed on top of each other and were unreadable at any width. `TimeSeriesChart` drops
 * the always-on labels for a hover/keyboard tooltip (the same trade `RevenueChart` already made)
 * and moves the three reference figures into the legend row, which wraps instead of colliding —
 * both problems it shipped with, fixed once for every chart on this frame rather than re-solved
 * bar by bar.
 *
 * FUTURE MONTHS RENDER NOTHING. The source spreadsheet shows `#WERT!` for months with no data
 * and F4 is explicit that we must not reproduce that — nor substitute a zero, which reads as
 * "achieved nothing" rather than "not yet". `isFuture` is the guard; the actual bar is simply
 * not drawn (`values` carries `null`), and the tooltip's data table reflects the same gap.
 */
export function CumulativeTrackingChart({ data }: { data: AnnualPerformance }) {
  const { year, months, fullYearTargetInr, achievedToDateInr, projectedYearEndInr } = data;
  const compact = (v: number) => formatInrMinor(v, { compact: true });

  return (
    <TimeSeriesChart
      mode="column"
      height={300}
      points={months.map((m) => ({ label: m.label, fullLabel: `${m.label} ${year}` }))}
      series={[
        {
          key: "forecast",
          label: "Forecast cumulative",
          color: "var(--ink-3)",
          compare: true,
          values: months.map((m) => m.cumTargetInr),
        },
        {
          key: "actual",
          label: "Actual cumulative",
          color: "var(--primary)",
          // A future month has achieved nothing YET, which is not a measured zero (F4) — so it
          // draws no bar at all rather than a bar of height zero.
          values: months.map((m) => (m.isFuture ? null : m.cumAchievedInr)),
        },
      ]}
      referenceLines={[
        { value: fullYearTargetInr, label: "Plan total", color: "var(--bad)" },
        { value: achievedToDateInr, label: "Actual total", color: "var(--good)" },
        { value: projectedYearEndInr, label: "Annualised", color: "var(--primary)" },
      ]}
      formatValue={compact}
      formatTooltip={(v) => formatInrMinor(v)}
      extraTooltipRows={(i) => {
        const m = months[i];
        if (!m || m.isFuture) return [];
        const varianceInr = m.cumAchievedInr - m.cumTargetInr;
        return [
          {
            label: varianceInr >= 0 ? "Ahead of plan" : "Behind plan",
            value: formatInrMinor(Math.abs(varianceInr)),
          },
        ];
      }}
      srCaption={`Cumulative forecast versus actual for ${year}, month by month`}
      emptyTitle="No targets set yet"
      emptyBody="Set a monthly target in the Console to see the plan line here."
    />
  );
}
