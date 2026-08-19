"use client";

import { TimeSeriesChart } from "@/components/ui/chart";

/**
 * New leads per day for the last 7 days, against the same weekdays a week earlier.
 *
 * A Client Component because `TimeSeriesChart` takes `formatValue` / `formatTooltip` - functions
 * cannot be passed from a Server Component into a Client one, and `pipeline/page.tsx` is async.
 * Same reason `FunnelTables.tsx` exists; see the note at the top of that file.
 *
 * Columns, not a line: seven discrete days being compared, where the reader's question is "which
 * days were quiet", not "what is the slope". The comparison series is drawn hollow rather than as
 * a second solid block, so the current week stays the thing the eye lands on.
 */
export function LeadFlowChart({
  items,
}: {
  items: Array<{ label: string; fullLabel: string; value: number; priorValue: number }>;
}) {
  return (
    <TimeSeriesChart
      points={items.map((d) => ({ label: d.label, fullLabel: d.fullLabel }))}
      series={[
        {
          key: "this-week",
          label: "This week",
          color: "var(--viz-1)",
          values: items.map((d) => d.value),
        },
        {
          key: "last-week",
          label: "Same day last week",
          color: "var(--ink-3)",
          compare: true,
          values: items.map((d) => d.priorValue),
        },
      ]}
      mode="column"
      height={200}
      formatValue={(v) => String(Math.round(v))}
      srCaption="New leads per day for the last 7 days, against the same weekdays a week earlier"
      emptyTitle="No leads in the last 7 days"
      emptyBody="New leads appear here the day they are captured."
    />
  );
}
