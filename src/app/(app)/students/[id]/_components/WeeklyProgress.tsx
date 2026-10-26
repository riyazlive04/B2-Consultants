"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, TrendingUp } from "lucide-react";
import type { WeeklyReport } from "@/lib/weekly-report";
import { Card, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

/**
 * THE WEEKLY PROGRESS REPORT (@33:47).
 *
 * ── Why it sits under the sprint tracker rather than replacing it ──────────────────────
 * The tracker is an EDITOR - the coach sets each week's target there and records the verdict.
 * This is a read: what the records say the student actually did in that week, beside what they
 * said they did. Folding the two together would have put uneditable measured numbers into a row
 * of input boxes, which reads as a form that silently ignores half of itself.
 *
 * ── Every number here is already on another screen ─────────────────────────────────────
 * Attendance comes from the register, coursework from the ticks, applications from the tracker,
 * connections and wins from the student's own log - the same tables, columns and date fields the
 * leaderboard scores (see server/weekly-report.ts). Nothing is stored for this report, so it
 * cannot drift from the screen that owns each figure.
 *
 * ── A dash is not a zero ───────────────────────────────────────────────────────────────
 * The attendance cell shows "-" where no register was taken that week, never 0%. Showing 0%
 * would report the coach's own outstanding register back to them as their student's absence,
 * which is the one reading of this table that would make it worse than not having it.
 *
 * Presentational and stateless: it takes a report the server already built.
 */

const STATE_PILL: Record<string, { tone: "good" | "bad" | "warn" | "neutral" | "primary"; label: string }> = {
  JUDGED: { tone: "good", label: "reviewed" },
  AWAITING_COACH: { tone: "primary", label: "your verdict" },
  OVERDUE: { tone: "warn", label: "not filled in" },
  AWAITING_STUDENT: { tone: "neutral", label: "open" },
  NOT_STARTED: { tone: "neutral", label: "upcoming" },
};

function Trend({ trend, delta }: { trend: WeeklyReport["rows"][number]["trend"]; delta: number | null }) {
  // Null means there is nothing to compare against - the first week, or a week still running.
  // Drawing "level" there would be a claim the data does not support.
  if (trend === null || delta === null) return <span className="text-muted">-</span>;
  if (trend === "LEVEL") {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-muted">
        <ArrowRight size={12} aria-hidden /> same
      </span>
    );
  }
  const up = trend === "UP";
  return (
    <span className={`inline-flex items-center gap-1 text-caption font-semibold ${up ? "text-good" : "text-warn"}`}>
      {up ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
      {up ? "+" : "-"}
      {Math.abs(delta)}
    </span>
  );
}

export function WeeklyProgress({ report }: { report: WeeklyReport }) {
  const { rows, summary } = report;

  /**
   * Weeks that have not started are dropped from the TABLE but stay in the report.
   *
   * The sprint tracker above already lists every planned week, including the future ones a
   * coach sets targets on. Repeating eight empty rows here would bury the weeks that have
   * actually happened - which are the only ones this screen has anything to say about.
   */
  const happened = rows.filter((r) => r.state !== "NOT_STARTED");
  if (happened.length === 0) return null;

  return (
    <Card
      className="mt-5"
      title="Week by week"
      subtitle="What the records show, next to what they told you. Nothing here is editable - each number belongs to the screen it comes from."
      actions={
        summary.unansweredStreak >= 3 ? (
          <Pill tone="bad">{summary.unansweredStreak} weekends silent</Pill>
        ) : undefined
      }
    >
      {/*
        The summary line first, because it is the sentence a coach can open a call with.
        "Your best week was week 2 with 30" is a question worth asking; a table of 13 rows is
        something to read afterwards.
      */}
      <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span>
          <span className="font-semibold text-ink">{summary.weeksClosed}</span> week
          {summary.weeksClosed === 1 ? "" : "s"} closed
        </span>
        <span>
          <span className="font-semibold text-good">{summary.achieved}</span> achieved
          {summary.missed > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-warn">{summary.missed}</span> missed
            </>
          )}
        </span>
        {summary.unanswered > 0 && (
          <span>
            <span className="font-semibold text-warn">{summary.unanswered}</span> never filled in
          </span>
        )}
        {summary.awaitingCoach > 0 && (
          <span>
            <span className="font-semibold text-primary">{summary.awaitingCoach}</span> waiting on you
          </span>
        )}
        <span>
          <span className="font-semibold text-ink">{summary.totalOutreach}</span> applications &amp;
          connections → <span className="font-semibold text-ink">{summary.totalInterviews}</span> interview
          {summary.totalInterviews === 1 ? "" : "s"}
        </span>
        {summary.attendance && (
          <span>
            attendance <span className="font-semibold text-ink">{summary.attendance.pct}%</span>
            <span className="text-muted"> ({summary.attendance.attended} of {summary.attendance.of} marked)</span>
          </span>
        )}
        {summary.bestWeek && (
          <span className="inline-flex items-center gap-1 text-good">
            <TrendingUp size={13} aria-hidden /> best was week {summary.bestWeek.weekIndex} ({summary.bestWeek.outreach})
          </span>
        )}
      </p>

      <TableShell
        minWidth={880}
        head={
          <>
            <Th>Week</Th>
            <Th>Target → what they said</Th>
            <Th align="right">Attendance</Th>
            <Th align="right">Coursework</Th>
            <Th align="right">Outreach</Th>
            <Th align="right">Interviews</Th>
            <Th align="right">vs last</Th>
          </>
        }
      >
        <>
          {happened.map((r) => (
            <Tr key={r.id}>
              <Td>
                <span className="font-semibold text-ink">W{r.weekIndex}</span>
                <span className="block text-caption tabular-nums text-muted">
                  {formatDate(r.weekStartYmd)}
                </span>
              </Td>
              <Td>
                <span className="text-sm text-ink-2">{r.target ?? "No target set"}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-ink">{r.actual ?? "-"}</span>
                  <Pill tone={STATE_PILL[r.state].tone}>{STATE_PILL[r.state].label}</Pill>
                </span>
                {/*
                  The note is the half worth reading. On an overdue week the student is asked
                  "what got in the way?" and the answer lands here - which is more use to a
                  coach than the number it replaced.
                */}
                {r.note && <span className="mt-0.5 block text-caption text-muted">{r.note}</span>}
              </Td>
              <Td align="right">
                {r.attendance === null ? (
                  <span className="text-muted" title="No register was taken this week">
                    -
                  </span>
                ) : (
                  <span className="tabular-nums text-ink">
                    {r.attendance.attended}/{r.attendance.of}
                    <span className="block text-caption text-muted">{r.attendance.pct}%</span>
                  </span>
                )}
              </Td>
              <Td align="right">
                <span className="tabular-nums text-ink">{r.tasksDone}</span>
              </Td>
              <Td align="right">
                <span className="tabular-nums text-ink">{r.outreach}</span>
              </Td>
              <Td align="right">
                <span className="tabular-nums text-ink">{r.interviews}</span>
                {r.wins > 0 && <span className="block text-caption text-good">{r.wins} win{r.wins === 1 ? "" : "s"}</span>}
              </Td>
              <Td align="right">
                <Trend trend={r.trend} delta={r.delta} />
              </Td>
            </Tr>
          ))}
        </>
      </TableShell>
    </Card>
  );
}
