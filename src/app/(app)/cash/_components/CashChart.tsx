"use client";

import { useMemo } from "react";
import { TimeSeriesChart } from "@/components/ui/chart";
import { compactInrMinor } from "@/lib/chart";
import { formatDate, formatInrMinor } from "@/lib/format";

/**
 * Bank-balance trend (PRD3 §4.1, DESIGN §5.8 "Line").
 *
 * Now a thin adapter over the shared chart system rather than its own SVG. The hand-rolled
 * version shipped three defects that the shared frame fixes structurally, not by patching:
 *
 *   1. **The tooltip was invisible in dark mode.** It drew `fill="#fff"` on a `var(--ink)`
 *      surface. `--ink` is near-WHITE under `[data-theme="dark"]`, so the readout was white text
 *      on a white box - the exact failure DESIGN §1.4 names ("anything that used bg-ink +
 *      text-white must use text-surface instead"). The shared tooltip is HTML and uses the token.
 *   2. **Axis text sat at 8–9.5px** against §7's stated 12px floor. Those were viewBox units, so
 *      the rendered size drifted with the card's width and could not be honoured or even
 *      measured. The frame measures a real pixel box, so 12px is 12px.
 *   3. **Gridlines were `[min, mid, max]`** - labels like "₹3,47,912" that no reader recognises.
 *      `niceTicks` puts them on the 1/2/5 ladder instead.
 *
 * It also gains what no bespoke chart had: keyboard access to every point (arrow keys), a
 * screen-reader data table, and real empty/loading states.
 *
 * ZERO-BASED ON PURPOSE. A line chart normally fits its own domain so movement is visible, but
 * this page's question is survival - "how close to zero is the balance" is the whole thesis of
 * Cash Health, and a floating baseline hides exactly that.
 */
export function CashChart({ points }: { points: Array<{ date: string; balanceInr: number }> }) {
  // `balanceInr` is MINOR units (paise) despite the name - cash-metrics maps it straight off
  // `bankBalanceInrMinor`. Every formatter here treats it as such.
  const data = useMemo(
    () => ({
      points: points.map((p) => ({ label: shortDate(p.date), fullLabel: formatDate(p.date) })),
      series: [
        {
          key: "balance",
          label: "Cash in Hand",
          color: "var(--primary)",
          values: points.map((p) => p.balanceInr),
        },
      ],
    }),
    [points],
  );

  return (
    <TimeSeriesChart
      points={data.points}
      series={data.series}
      mode="area"
      height={240}
      zeroBased
      formatValue={(v) => compactInrMinor(v)}
      formatTooltip={(v) => formatInrMinor(v)}
      srCaption="Cash in Hand at each weekly position"
      emptyTitle="Not enough entries yet"
      emptyBody="Add at least two weekly cash positions to see the trend."
      footnote="One point per recorded cash position. This is measured balance, not a forecast."
    />
  );
}

/** "07/07" - the axis wants a rhythm to count by; the tooltip carries the full DD/MM/YYYY. */
function shortDate(iso: string): string {
  return formatDate(iso).slice(0, 5);
}
