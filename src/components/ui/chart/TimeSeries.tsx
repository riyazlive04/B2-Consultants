"use client";

import { useMemo, useState } from "react";
import {
  COMPARE_DASH,
  areaPath,
  bandPath,
  barPath,
  bandScale,
  domainFor,
  linePath,
  linearScale,
  pointScale,
  seriesColor,
  splitAtCrossings,
  tickIndices,
  type BandPoint,
  type Pt,
} from "@/lib/chart";
import { ChartFrame, ChartTooltip, useChartCursor, type ChartState, type LegendItem } from "./ChartFrame";

/**
 * Trend chart - line, area or column, over an ordered axis (§5.8 "Line", "Bar").
 *
 * WHEN TO REACH FOR THIS (the analyst rule, so the choice isn't taste):
 *   - **line**   - a continuous quantity read for DIRECTION over many periods (cash balance,
 *                  win rate). Connecting the points asserts continuity between them, so it is
 *                  wrong for discrete buckets that don't flow into each other.
 *   - **area**   - a line whose distance from zero is also the point (revenue, volume). Only
 *                  ever for a single series: two overlapping translucent fills are unreadable.
 *   - **column** - few, discrete periods being COMPARED rather than tracked (6 months of
 *                  enrolments). Columns invite comparing heights; lines invite reading slope.
 *
 * The comparison series (`compare: true`) is the previous period drawn behind the current one:
 * dashed for a line, hollow for a column, so it survives greyscale (§7 - never colour alone).
 */

export type TimeSeriesDatum = {
  /** x-axis label - a month, a week ending, a stage name. */
  label: string;
  /** Long form for the tooltip, where there is room ("July 2026" vs "Jul"). */
  fullLabel?: string;
};

export type TimeSeries = {
  key: string;
  label: string;
  /** Aligned 1:1 with `points`. `null` is a real gap - no data, drawn as a break, not a zero. */
  values: readonly (number | null)[];
  color?: string;
  /** Renders as the "previous period" ghost. */
  compare?: boolean;
  /**
   * Colour each column by the SIGN of its value (column mode only) - gained green above the
   * axis, lost red below it.
   *
   * A diverging chart, without a separate mode: `barPath` already measures from the value to the
   * zero line in whichever direction that runs, so the only thing a gain/loss chart needed was
   * for the two directions to be told apart. One series carrying signed values also keeps the
   * NET readable, which is the point of the chart - two opposed series would hide the month
   * where four joined and four left.
   */
  signedColors?: { positive: string; negative: string };
};

/**
 * Shade the gap between two series - green where the first is ahead, red where it is behind.
 *
 * For target-vs-actual, where the *gap* is the answer and making the reader measure it against a
 * y-axis is the work the chart exists to remove. Crossings are interpolated (`splitAtCrossings`),
 * so the colour changes exactly where the lines meet.
 */
export type TimeSeriesBand = {
  /** Series key that reads as "ahead" when it is the higher value (usually actual). */
  aheadKey: string;
  /** The series it is measured against (usually target). */
  behindKey: string;
  aheadColor?: string;
  behindColor?: string;
};

export type TimeSeriesMode = "line" | "area" | "column";

export function TimeSeriesChart({
  points,
  series,
  mode = "line",
  height = 240,
  state = "ready",
  formatValue,
  formatTooltip,
  zeroBased,
  emptyTitle,
  emptyBody,
  footnote,
  srCaption,
  toolbar,
  yAxisLabel,
  band,
  referenceLines,
  extraTooltipRows,
}: {
  points: readonly TimeSeriesDatum[];
  series: readonly TimeSeries[];
  mode?: TimeSeriesMode;
  height?: number;
  state?: ChartState;
  /**
   * Axis labels. Keep it COMPACT - an axis is read peripherally and "₹3.5L" scans where
   * "₹3,50,000.00" becomes a wall of digits that widens the gutter and crowds the plot.
   */
  formatValue: (v: number) => string;
  /**
   * Tooltip figures. Defaults to `formatValue`, but money should override it with the full
   * grouped figure (§3): the tooltip is the deliberate, focused read, and that is exactly where
   * rounding ₹3,47,912 to "₹3.5L" costs the reader the answer they hovered to get.
   */
  formatTooltip?: (v: number) => string;
  /**
   * Force the baseline. Defaults to zero for area/column (where bar length IS the quantity, so a
   * floating baseline lies) and to a fitted domain for lines (where a ₹4.4L balance moving ₹20k
   * is invisible against a zero axis).
   */
  zeroBased?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  footnote?: React.ReactNode;
  srCaption: string;
  toolbar?: React.ReactNode;
  yAxisLabel?: string;
  /** Shade the variance between two of the series above. See `TimeSeriesBand`. */
  band?: TimeSeriesBand;
  /**
   * Horizontal rules at fixed values - a plan total, a run-rate projection, a break-even line.
   * Each is labelled twice over, deliberately redundant: inline beside its own line (with the
   * OTHER lines' labels pushed clear of it, so a plan total and an annualised figure sitting
   * close together on the scale never print on top of one another) AND in the legend row above
   * the chart, which wraps and never collides regardless of card width - the inline label is the
   * "which line is this" read, the legend is the one guaranteed legible on a phone.
   */
  referenceLines?: Array<{ value: number; label: string; color?: string }>;
  /**
   * Rows appended to the tooltip for the hovered index - a running total, a share, a delta.
   *
   * A DERIVED figure often belongs in the readout without belonging on the plot: Finance's daily
   * revenue chart wants "and the month stands at ₹X", which is the number actually being chased
   * but would flatten the daily bars if plotted beside them.
   */
  extraTooltipRows?: (index: number) => Array<{ label: string; value: string }>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [activeSeries, setActiveSeries] = useState<number | null>(null);
  const cursor = useChartCursor(points.length, setHover);
  const active = hover ?? cursor.index;

  const live = series.filter((s) => !s.compare);
  const isEmpty =
    points.length === 0 ||
    series.length === 0 ||
    series.every((s) => s.values.every((v) => v == null));

  const legend: LegendItem[] = [
    ...series.map((s, i) => ({
      label: s.label,
      color: s.color ?? seriesColor(i),
      dashed: s.compare,
    })),
    // Reference lines carry their figure right in the legend - the one place guaranteed to
    // wrap and stay legible regardless of card width, which the inline plot label is not.
    ...(referenceLines ?? []).map((rl) => ({
      label: rl.label,
      color: rl.color ?? "var(--ink-3)",
      dashed: true,
      value: formatValue(rl.value),
    })),
  ];

  const allValues = useMemo(
    () => [
      ...series.flatMap((s) => s.values.filter((v): v is number => v != null)),
      // A reference line can sit well above every plotted value (a full-year plan against five
      // months of actuals) - it has to widen the domain itself, or it draws off the top of the
      // plot and simply never appears.
      ...(referenceLines ?? []).map((rl) => rl.value),
    ],
    [series, referenceLines],
  );

  return (
    <ChartFrame
      height={height}
      state={isEmpty && state === "ready" ? "empty" : state}
      legend={legend.length > 1 ? legend : undefined}
      // Reference-line legend rows live past `series.length` in the merged array - dimming is
      // only meaningful for an actual plotted series, so a reference-line hover is a no-op
      // rather than fading every series out from under it.
      onLegendHover={(i) => setActiveSeries(i != null && i < series.length ? i : null)}
      activeSeries={activeSeries}
      emptyTitle={emptyTitle ?? "Nothing to plot yet"}
      emptyBody={emptyBody ?? "This chart fills in as records are created in the selected period."}
      footnote={footnote}
      srCaption={srCaption}
      toolbar={toolbar}
      data={{
        columns: ["Period", ...series.map((s) => s.label)],
        rows: points.map((p, i) => [
          p.fullLabel ?? p.label,
          ...series.map((s) => (s.values[i] == null ? "No data" : formatValue(s.values[i] as number))),
        ]),
      }}
    >
      {({ width }) => {
        // ── plot box ──
        // The left gutter is derived from the widest y label rather than fixed: "₹1.2Cr" and "8"
        // need very different room, and a fixed gutter either clips the first or wastes a tenth
        // of a narrow card on the second.
        const { min, max, ticks } = domainFor(allValues, {
          zeroBased: zeroBased ?? mode !== "line",
          target: height > 200 ? 4 : 3,
        });
        const yLabels = ticks.map(formatValue);
        const padLeft = Math.min(88, Math.max(34, Math.max(...yLabels.map((l) => l.length)) * 7 + 12));
        const padRight = 8;
        const padTop = 10;
        const padBottom = 26;
        const plotW = Math.max(1, width - padLeft - padRight);
        const plotH = Math.max(1, height - padTop - padBottom);

        const y = linearScale([min, max], [padTop + plotH, padTop]);
        const isColumn = mode === "column";

        /**
         * Gutter between columns, as a share of each slot.
         *
         * 0.3 is the house value, and it is the right one for a dozen months across a full-width
         * card. It is the wrong one for a DENSE series in a narrow one: a month of daily takings in
         * a bento cell is ~10px per day, and taking 30% of that leaves a 6px bar - thinner than its
         * own 4px corner radius, so it reads as a tick mark rather than a quantity. Below a 14px
         * slot the gutter tightens to the minimum that still separates neighbours.
         */
        const slot = plotW / Math.max(1, points.length);
        const bandPad = slot < 14 ? 0.12 : 0.3;
        const x = isColumn
          ? bandScale(points.length, [padLeft, padLeft + plotW], bandPad).center
          : pointScale(points.length, [padLeft, padLeft + plotW]);

        const zeroY = min <= 0 && max >= 0 ? y(0) : null;
        const xTicks = tickIndices(points.length, Math.max(2, Math.floor(plotW / 68)));

        // Columns share each band between the live series, so grouped bars sit side by side
        // rather than hiding one another.
        const group = bandScale(points.length, [padLeft, padLeft + plotW], bandPad);
        const perSeriesW = Math.max(2, group.width / Math.max(1, series.length));

        return (
          <>
            <svg
              width={width}
              height={height}
              className="block touch-none rounded-field"
              /* Focusable (arrow keys walk the series), so it must NOT be aria-hidden - a
                 focusable node missing from the accessibility tree strands a screen-reader
                 user on an element their software cannot describe. It announces itself as an
                 image and hands the actual numbers to the sr-only table below. */
              role="img"
              aria-label={`${srCaption}. Use arrow keys to read each point; a data table follows.`}
              {...cursor.props}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const px = e.clientX - rect.left;
                const t = (px - padLeft) / plotW;
                // Columns own a BAND each, lines only a point, so they need different arithmetic.
                // Rounding to the nearest of n-1 divisions (the line formula) drifts by up to half a
                // band on a column chart, which was enough to highlight the 13th while the cursor
                // sat on the 12th. Flooring into n equal bands lands on the column under the pointer.
                // Clamped either way: the pointer is often in the axis gutter, and snapping to the
                // end is what the reader means when they run off the edge.
                const idx = isColumn
                  ? Math.floor(t * points.length)
                  : Math.round(t * Math.max(1, points.length - 1));
                setHover(Math.max(0, Math.min(points.length - 1, idx)));
              }}
            >
              {/* ── gridlines + y labels ── */}
              {ticks.map((t, i) => (
                <g key={`t-${t}`}>
                  <line
                    x1={padLeft}
                    x2={padLeft + plotW}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="var(--viz-grid)"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={padLeft - 8}
                    y={y(t)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    /* 12px, in real pixels - §7's floor, which a viewBox-scaled chart cannot honour */
                    fontSize={12}
                    fill="var(--viz-ink)"
                  >
                    {yLabels[i]}
                  </text>
                </g>
              ))}

              {/* A crossed zero gets a stronger rule: on a chart with negative values, "which side
                  of zero" is the first thing read, and a gridline identical to the others hides it. */}
              {zeroY !== null && ticks.length > 1 && (
                <line
                  x1={padLeft}
                  x2={padLeft + plotW}
                  y1={zeroY}
                  y2={zeroY}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              )}

              {/* ── x labels ── */}
              {xTicks.map((i) => (
                <text
                  key={`x-${i}`}
                  x={x(i)}
                  y={height - 8}
                  textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                  fontSize={12}
                  fill="var(--viz-ink)"
                >
                  {points[i]?.label}
                </text>
              ))}

              {/* ── the crosshair sits UNDER the marks, so it never veils the data it points at ── */}
              {active !== null && !isColumn && (
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={padTop}
                  y2={padTop + plotH}
                  stroke="var(--viz-ink)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              )}
              {/* The whole SLOT lights up, not just the bar's band. On a dense chart the bar is a
                  few pixels wide, and a highlight the same width is as hard to see as the bar it is
                  meant to point out; the slot is the region the pointer actually selects. */}
              {active !== null && isColumn && (
                <rect
                  x={padLeft + active * slot}
                  y={padTop}
                  width={slot}
                  height={plotH}
                  fill="var(--bg-surface-2)"
                  opacity={0.7}
                />
              )}

              {/* ── variance band ──
                  Drawn before the lines so the fill sits UNDER them, and at low opacity: it is
                  the context for the two series, not a third series competing with them. */}
              {band &&
                (() => {
                  const a = series.find((s) => s.key === band.aheadKey);
                  const b = series.find((s) => s.key === band.behindKey);
                  if (!a || !b) return null;
                  // Only spans where BOTH series have a value can be shaded - a gap has no gap.
                  const runs: BandPoint[][] = [];
                  let run: BandPoint[] = [];
                  points.forEach((_, i) => {
                    const av = a.values[i];
                    const bv = b.values[i];
                    if (av == null || bv == null) {
                      if (run.length) runs.push(run);
                      run = [];
                      return;
                    }
                    run.push({ x: x(i), aY: y(av), bY: y(bv) });
                  });
                  if (run.length) runs.push(run);

                  return runs.flatMap((r, ri) =>
                    splitAtCrossings(r).map((seg, si2) => (
                      <path
                        key={`band-${ri}-${si2}`}
                        d={bandPath(seg.points)}
                        fill={
                          seg.ahead
                            ? (band.aheadColor ?? "var(--good)")
                            : (band.behindColor ?? "var(--bad)")
                        }
                        opacity={0.16}
                      />
                    )),
                  );
                })()}

              {/* ── reference lines ──
                  Labels are stacked top-to-bottom with a minimum gap rather than pinned each to
                  its own line: a plan total and a run-rate projection routinely land within a
                  few pixels of each other on the same scale, and two 12px labels that close
                  print on top of one another - which is the exact bug this replaces. Sorting by
                  pixel position and pushing later labels down (never up) keeps every label
                  readable while leaving the dashed lines themselves at their true value. */}
              {(() => {
                const inRange = (referenceLines ?? []).filter((rl) => rl.value >= min && rl.value <= max);
                const minGap = 13;
                let prevLabelY = -Infinity;
                const laid = [...inRange]
                  .sort((a, b) => y(a.value) - y(b.value))
                  .map((rl) => {
                    const rawY = y(rl.value);
                    const labelY = Math.max(rawY - 5, prevLabelY + minGap, 10);
                    prevLabelY = labelY;
                    return { ...rl, rawY, labelY };
                  });
                return laid.map((rl, i) => (
                  <g key={`ref-${i}`}>
                    <line
                      x1={padLeft}
                      x2={padLeft + plotW}
                      y1={rl.rawY}
                      y2={rl.rawY}
                      stroke={rl.color ?? "var(--ink-3)"}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                    <text
                      x={padLeft + plotW}
                      y={rl.labelY}
                      textAnchor="end"
                      fontSize={12}
                      fill={rl.color ?? "var(--ink-3)"}
                    >
                      {rl.label} · {formatValue(rl.value)}
                    </text>
                  </g>
                ));
              })()}

              {/* ── series ── */}
              {series.map((s, si) => {
                const color = s.color ?? seriesColor(si);
                const dim = activeSeries != null && activeSeries !== si;
                const opacity = dim ? 0.25 : 1;

                if (isColumn) {
                  return (
                    <g key={s.key} opacity={opacity} style={{ transition: "opacity var(--dur-fast) var(--ease-out)" }}>
                      {s.values.map((v, i) => {
                        if (v == null) return null;
                        const bx = group.band(i) + si * perSeriesW;
                        const top = Math.min(y(v), y(0));
                        const h = Math.abs(y(v) - y(Math.max(min, 0)));
                        const d = barPath(bx, top, perSeriesW - 1, h, 4);
                        if (!d) return null;
                        // Sign-aware fill turns one signed series into a diverging chart.
                        const fill = s.signedColors
                          ? v < 0
                            ? s.signedColors.negative
                            : s.signedColors.positive
                          : color;
                        return s.compare ? (
                          // Hollow + dashed: a second solid fill would compete with the current
                          // period for the eye, and the current period is the answer.
                          <path key={i} d={d} fill="none" stroke={fill} strokeWidth={1.5} strokeDasharray={COMPARE_DASH} />
                        ) : (
                          <path key={i} d={d} fill={fill} />
                        );
                      })}
                    </g>
                  );
                }

                // Line / area. Null values break the path into segments rather than being
                // interpolated over - drawing straight through a gap invents data.
                const segments: Pt[][] = [];
                let run: Pt[] = [];
                s.values.forEach((v, i) => {
                  if (v == null) {
                    if (run.length) segments.push(run);
                    run = [];
                  } else {
                    run.push({ x: x(i), y: y(v) });
                  }
                });
                if (run.length) segments.push(run);

                const gradId = `area-${s.key.replace(/[^a-zA-Z0-9_-]/g, "")}-${si}`;
                return (
                  <g key={s.key} opacity={opacity} style={{ transition: "opacity var(--dur-fast) var(--ease-out)" }}>
                    {mode === "area" && !s.compare && (
                      <>
                        <defs>
                          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        {segments.map((seg, i) =>
                          seg.length > 1 ? (
                            <path key={i} d={areaPath(seg, padTop + plotH)} fill={`url(#${gradId})`} />
                          ) : null,
                        )}
                      </>
                    )}
                    {segments.map((seg, i) => (
                      <path
                        key={i}
                        d={linePath(seg)}
                        fill="none"
                        stroke={color}
                        strokeWidth={s.compare ? 1.75 : 2.5}
                        strokeDasharray={s.compare ? COMPARE_DASH : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {/* A single surviving datum has no line to be seen as, so it gets a dot. */}
                    {segments
                      .filter((seg) => seg.length === 1)
                      .map((seg, i) => (
                        <circle key={`solo-${i}`} cx={seg[0].x} cy={seg[0].y} r={3} fill={color} />
                      ))}
                    {active !== null && s.values[active] != null && (
                      <circle
                        cx={x(active)}
                        cy={y(s.values[active] as number)}
                        r={4.5}
                        fill={color}
                        stroke="var(--bg-surface)"
                        strokeWidth={2}
                      />
                    )}
                  </g>
                );
              })}
            </svg>

            {active !== null && points[active] && (
              <ChartTooltip
                x={x(active)}
                /* Sit above the HIGHEST live mark at this index. `live` can be empty (a chart
                   showing only a comparison series), and Math.min() of nothing is Infinity -
                   which would place the box off-screen, so fall back to the plot floor. */
                y={(() => {
                  const tops = live
                    .map((s) => s.values[active])
                    .filter((v): v is number => v != null)
                    .map((v) => y(v));
                  return Math.max(0, (tops.length ? Math.min(...tops) : padTop + plotH) - 12);
                })()}
                width={width}
                title={points[active].fullLabel ?? points[active].label}
                rows={[
                  ...series.map((s, si) => ({
                    label: s.label,
                    color: s.color ?? seriesColor(si),
                    value:
                      s.values[active] == null
                        ? "-"
                        : (formatTooltip ?? formatValue)(s.values[active] as number),
                  })),
                  // Derived rows carry no swatch: nothing on the plot corresponds to them, and a
                  // colour dot would promise a mark the reader then hunts for.
                  ...(extraTooltipRows?.(active) ?? []),
                ]}
                footer={yAxisLabel}
              />
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}
