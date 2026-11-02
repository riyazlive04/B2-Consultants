"use client";

import { Card } from "@/components/ui/kit";
import { TimeSeriesChart } from "@/components/ui/chart";
import { formatDate } from "@/lib/format";
import type { WeeklyPulseWeek } from "@/server/weekly-report-board";

/**
 * THE WEEKLY PULSE - submissions and output, week by week, across every cohort you run.
 *
 * The founders' tracker had this as a block headed "WEEKLY PULSE (UPDATE EVERY MONDAY)" with
 * five columns somebody filled in by hand. It had one row in it.
 *
 * Two charts rather than one because the two questions are different shapes: whether people
 * are answering is a compare-the-weeks question (columns), and whether output is rising is a
 * direction question (a line). Mixing submissions and applications on one axis would also put
 * a count of eight beside a count of two hundred and flatten the smaller one into the floor.
 *
 * A week nobody was asked a countable question in is a GAP, not a zero - lib/chart.ts draws
 * null as a break, and a zero there would read as a collapse in activity that never happened.
 */
export function WeeklyPulse({ weeks }: { weeks: WeeklyPulseWeek[] }) {
  const points = weeks.map((w) => ({
    label: formatDate(w.weekStart).slice(0, 5),
    fullLabel: `Week of ${formatDate(w.weekStart)}`,
  }));

  return (
    <div className="space-y-4">
      <Card
        title="Who answered"
        subtitle="Reports in against reports missing, for every cohort you run, by calendar week."
      >
        <TimeSeriesChart
          mode="column"
          points={points}
          state={weeks.length === 0 ? "empty" : "ready"}
          emptyTitle="No weeks yet"
          emptyBody="Once a cohort's first weekly report closes, its submissions appear here."
          formatValue={(v) => String(Math.round(v))}
          srCaption="Weekly report submissions and misses by week"
          series={[
            { key: "submitted", label: "Submitted", values: weeks.map((w) => w.submitted) },
            { key: "missing", label: "Missing", values: weeks.map((w) => w.missing) },
          ]}
        />
      </Card>

      <Card
        title="What they reported"
        subtitle="The cohort's own totals - applications sent and interviews had - as the students reported them."
      >
        <TimeSeriesChart
          mode="line"
          points={points}
          state={weeks.length === 0 ? "empty" : "ready"}
          emptyTitle="Nothing reported yet"
          emptyBody="These are the numbers students type into their weekly form."
          formatValue={(v) => String(Math.round(v))}
          srCaption="Self-reported applications and interviews by week"
          footnote="Self-reported. The Leaderboard scores measured activity, and the two will not always agree."
          series={[
            { key: "applications", label: "Applications", values: weeks.map((w) => w.applications) },
            { key: "interviews", label: "Interviews", values: weeks.map((w) => w.interviews) },
          ]}
        />
      </Card>
    </div>
  );
}
