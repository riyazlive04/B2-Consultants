"use client";

import { TimeSeriesChart } from "@/components/ui/chart";
import { formatEurMinor, formatInrMinor, formatPct } from "@/lib/format";
import { useFinanceCcy } from "./FinanceCurrency";

/**
 * Daily revenue for the current month, one column per calendar day (§3.1).
 *
 * WHY THIS IS NO LONGER HAND-ROLLED SVG. It used to draw itself into a fixed
 * `viewBox="0 0 720 220"` stretched to the card. In the Finance bento that card is ~470px wide,
 * so everything rendered at 470/720 = **65% of its stated size**: the axis figures were declared
 * `fontSize="9"` and reached the screen at under 6px, against §7's 12px floor. The chart was
 * legible in the source and illegible on screen. `preserveAspectRatio` then letterboxed the 220-unit
 * drawing inside a 170px box, costing another ~13px of plot top and bottom.
 *
 * `ChartFrame` (via TimeSeriesChart) hands the plot a real PIXEL box instead of a scaled unit box,
 * which is the whole reason it exists — so 12px axis text is 12px. The hover readout comes with it
 * as an HTML tooltip, replacing the 132×50 SVG box whose four lines of 8.5px text rendered at ~5.5px.
 *
 * COLUMNS, not the area chart this once was: a day's takings are discrete events, and joining the
 * 12th to the 14th with a line asserts a revenue *rate* flowing between them that does not exist.
 * Every elapsed day gets a slot, so a dead week reads as a dead week rather than being skipped —
 * a month with income on the 2nd, 9th and 20th used to produce a 3-point chart that pretended
 * those days were adjacent.
 *
 * The running month total is deliberately NOT plotted — beside daily bars it would tower over them
 * and flatten the thing being read — but it IS the number being chased, so it rides in the tooltip
 * (`extraTooltipRows`, which the chart layer carries for exactly this case).
 *
 * Follows the page's ₹/€ toggle (B3). The EUR figures are summed server-side from each record's OWN
 * stamped rate, so the closing month-to-date here equals the revenue KPI above it exactly;
 * re-converting an INR total at today's rate would put two different EUR numbers for the same month
 * on one screen. The annual charts deliberately stay INR — they carry a target, and `MonthlyTarget`
 * has no EUR column, so a converted target would drift with the ECB.
 */

/** One calendar day of takings, with the running month total in both currencies. */
export type RevenuePoint = {
  date: string;
  inr: number;
  cumulativeInr: number;
  eur: number;
  cumulativeEur: number;
  /** Receipts that made up the day — 0 on a day with no collections. */
  count: number;
};

/**
 * Both formatters pin `timeZone: "UTC"`.
 *
 * These keys are calendar days, not instants: the server built them with `Date.UTC(y, m, d)` and
 * sliced the ISO date. Formatting them in the viewer's zone would shift a day backwards for anyone
 * west of UTC, so the 1st of the month could label itself "30 Jun".
 */
const DAY_NUM = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" });
const DAY_LONG = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function RevenueChart({ points, height = 200 }: { points: RevenuePoint[]; height?: number }) {
  const { ccy } = useFinanceCcy();
  const isInr = ccy === "INR";

  /** Axis: compact, read peripherally. Tooltip: the full grouped figure — that read is deliberate. */
  const axis = (v: number) =>
    isInr ? formatInrMinor(v, { compact: true }) : formatEurMinor(v, { compact: true });
  const full = (v: number) => (isInr ? formatInrMinor(v) : formatEurMinor(v));
  const other = (p: RevenuePoint) => (isInr ? formatEurMinor(p.eur) : formatInrMinor(p.inr));
  const dayValue = (p: RevenuePoint) => (isInr ? p.inr : p.eur);
  const cumulative = (p: RevenuePoint) => (isInr ? p.cumulativeInr : p.cumulativeEur);

  const monthTotal = points.length > 0 ? cumulative(points[points.length - 1]) : 0;
  const collecting = points.filter((p) => p.count > 0);
  const best = collecting.reduce<RevenuePoint | null>(
    (top, p) => (top === null || dayValue(p) > dayValue(top) ? p : top),
    null,
  );

  return (
    <TimeSeriesChart
      mode="column"
      height={height}
      /* Every day being zero is "nothing yet", not a chart of thirty flat bars. The frame's own
         empty test only fires on all-null, and a zero day is a real measured zero, not a gap. */
      state={monthTotal === 0 ? "empty" : "ready"}
      emptyTitle="No income recorded yet this month"
      emptyBody="Entries added on the Income tab appear here, one column per day."
      points={points.map((p) => ({
        label: DAY_NUM.format(new Date(p.date)),
        fullLabel: DAY_LONG.format(new Date(p.date)),
      }))}
      series={[
        {
          key: "revenue",
          label: "Collected",
          color: "var(--chart-1)",
          values: points.map(dayValue),
        },
      ]}
      formatValue={axis}
      formatTooltip={full}
      extraTooltipRows={(i) => {
        const p = points[i];
        if (!p) return [];
        const v = dayValue(p);
        return [
          // No swatch on these: nothing on the plot corresponds to them, and a colour dot would
          // promise a mark the reader then goes hunting for.
          { label: isInr ? "In euro" : "In rupees", value: other(p) },
          {
            label: "Receipts",
            value: p.count === 0 ? "none" : `${p.count} payment${p.count === 1 ? "" : "s"}`,
          },
          { label: "Month to date", value: full(cumulative(p)) },
          // A share of nothing is not an insight, and neither is "0% of the month".
          ...(v > 0 && monthTotal > 0
            ? [{ label: "Share of month", value: formatPct((v / monthTotal) * 100) }]
            : []),
        ];
      }}
      footnote={
        best !== null ? (
          <>
            {collecting.length} of {points.length} day{points.length === 1 ? "" : "s"} collected ·
            best was {DAY_LONG.format(new Date(best.date))} at{" "}
            <span className="tnum font-semibold text-ink-2">{full(dayValue(best))}</span> ·{" "}
            <span className="tnum font-semibold text-ink-2">
              {full(Math.round(monthTotal / Math.max(1, points.length)))}
            </span>{" "}
            a day across the month so far
          </>
        ) : undefined
      }
      srCaption={`Daily revenue this month in ${isInr ? "rupees" : "euro"}`}
      /* No `yAxisLabel`: it renders as a tooltip footer, and here it would only repeat the
         "Collected" row two lines above it. */
    />
  );
}
