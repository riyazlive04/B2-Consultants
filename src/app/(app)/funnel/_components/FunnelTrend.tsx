"use client";

import { TrendingUp } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/kit";
import { TimeSeriesChart, type TimeSeries } from "@/components/ui/chart";
import { formatPct } from "@/lib/format";
import type { FunnelOverview } from "@/server/funnel-metrics";

type Month = FunnelOverview["months"][number];

/**
 * Carry-through rate per stage, month over month.
 *
 * ── WHY THIS CHART EXISTS ────────────────────────────────────────────────────────────────────
 * The page already answers "where do people stop THIS month" (the funnel blocks) and "what were
 * the numbers each month" (the transposed metrics table). Neither answers the question a founder
 * actually acts on: **is the leak getting worse, or did we just have a quiet month?**
 *
 * A table of ten metrics across four months makes that a mental diff of forty cells. A line makes
 * it a glance — and the weakest-stage alert at the top of the page becomes checkable rather than
 * merely assertable, because you can see whether the stage it names has been sliding for three
 * months or dipped once.
 *
 * ── WHY RATES, NOT COUNTS ────────────────────────────────────────────────────────────────────
 * Plotting the raw stage counts on one axis is unreadable: awareness runs in the thousands and
 * enrolments in single digits, so every stage but the first flattens onto the baseline. A log
 * axis would fix the geometry and lose the audience. Rates put all four stages on one honest
 * 0–100 scale, and rate IS the question — "carry-through" is what a funnel measures.
 *
 * Volume still matters, and it is not hidden: the counts live in the funnel blocks above and the
 * metrics table below. This chart is deliberately the derivative, not the level.
 *
 * ── WHY LINE, NOT COLUMN ─────────────────────────────────────────────────────────────────────
 * Four series over several months. Columns would mean 16+ bars in groups, and the reader would
 * compare heights within a month when the question is direction across months.
 */

const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

const STAGES: { key: string; label: string; of: (m: Month) => number }[] = [
  { key: "awareness-lead", label: "Awareness → Lead", of: (m) => pct(m.leads, m.awareness) },
  { key: "lead-call", label: "Lead → Call", of: (m) => pct(m.calls, m.leads) },
  { key: "call-proposal", label: "Call → Proposal", of: (m) => pct(m.proposals, m.calls) },
  { key: "proposal-enrol", label: "Proposal → Enrolment", of: (m) => pct(m.enrollTotal, m.proposals) },
];

export function FunnelTrend({ months }: { months: Month[] }) {
  const series: TimeSeries[] = STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    values: months.map((m) => {
      // A month with no entries at the denominator has NO RATE — it is not 0%. Zeroing it would
      // draw a collapse that never happened, in the one chart whose whole job is spotting one.
      const denominatorMissing =
        (s.key === "awareness-lead" && m.awareness === 0) ||
        (s.key === "lead-call" && m.leads === 0) ||
        (s.key === "call-proposal" && m.calls === 0) ||
        (s.key === "proposal-enrol" && m.proposals === 0);
      return denominatorMissing ? null : s.of(m);
    }),
  }));

  return (
    <Card
      title={<CardTitle icon={<TrendingUp size={17} />}>Carry-through by stage, month over month</CardTitle>}
      subtitle="Is the leak getting worse, or was it a quiet month? Rates, so every stage sits on one scale."
    >
      <TimeSeriesChart
        points={months.map((m) => ({ label: shortMonth(m.label), fullLabel: m.label }))}
        series={series}
        mode="line"
        height={280}
        // Rates share a fixed, meaningful floor: 0% is a real bound here, not an arbitrary one,
        // and holding it stops a good month from being redrawn as a cliff by a rescaled axis.
        zeroBased
        formatValue={(v) => `${Math.round(v)}%`}
        formatTooltip={(v) => formatPct(v)}
        srCaption="Carry-through rate for each funnel stage, by month"
        emptyTitle="No weekly snapshots yet"
        emptyBody="Enter weekly funnel snapshots below and this fills in a month at a time."
        footnote="A gap means that stage had nothing entering it that month — no rate exists, so none is drawn."
      />
    </Card>
  );
}

/** "July 2026" → "Jul 26"; the tooltip keeps the full month. */
function shortMonth(label: string): string {
  const m = label.match(/^(\w{3})\w*\s+(\d{4})$/);
  return m ? `${m[1]} ${m[2].slice(2)}` : label;
}
