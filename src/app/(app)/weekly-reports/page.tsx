import { ClipboardList } from "lucide-react";
import { Card, EmptyState, EngineOffNotice, PageHeader } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { SectionLink } from "@/components/ui/SectionLink";
import { MetricCard } from "@/components/ui/MetricCard";
import { Tabs } from "@/components/ui/Tabs";
import { requireSection } from "@/lib/rbac";
import { enginesOff } from "@/server/engine-status";
import { getWeeklyAttention, getWeeklyBoard, getWeeklyPulse } from "@/server/weekly-report-board";
import { WeeklyDesk } from "./_components/WeeklyDesk";
import { WeeklyAttention } from "./_components/WeeklyAttention";
import { WeeklyPulse } from "./_components/WeeklyPulse";
import { WeeklyHistory } from "./_components/WeeklyHistory";

export const metadata = { title: "Weekly Reports" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null =>
  (Array.isArray(v) ? v[0] : v) || null;

/**
 * THE WEEKLY REPORT - who told us about their week, and who is slipping.
 *
 * This screen is the founders' student tracker, which until now was a Google Sheet worked
 * through by hand every Monday: open each sprint student, see whether their form arrived,
 * copy the numbers into two tabs, re-read the red-flag rules by eye, paste a WhatsApp
 * template. Each tab below is one block of that sheet:
 *
 *   This week      ← the Sprint Tracker tab (one row per student per week)
 *   Needs attention← the Dashboard's "Students Needing Attention", which the sheet asked a
 *                    person to "manually copy here weekly"
 *   Weekly pulse   ← the Dashboard's "WEEKLY PULSE (UPDATE EVERY MONDAY)"
 *   History        ← the Student Master tab's streak, last-form-date and weeks-silent columns
 *
 * Nothing on it is stored as a rollup. Every flag, streak and silence is derived from the
 * submissions by lib/weekly-flags.ts, because the sheet's own failure mode was a rollup
 * column that was only as true as the last person who remembered to update it.
 *
 * The cohort and the week live in the URL, so any view of this screen is a link worth sending.
 */
export default async function WeeklyReportsPage({ searchParams }: { searchParams: SP }) {
  const session = await requireSection("weekly-reports");

  const [board, attention, pulse, engines] = await Promise.all([
    getWeeklyBoard(session, { batchId: one(searchParams.batch), isoWeek: one(searchParams.week) }),
    getWeeklyAttention(session),
    getWeeklyPulse(session),
    enginesOff(["weeklyReport", "whatsapp"]),
  ]);

  const { totals } = board;
  const rate = totals.roster > 0 ? Math.round((totals.submitted / totals.roster) * 100) : null;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<ClipboardList size={22} strokeWidth={1.8} />}
        eyebrow="Classroom"
        title="Weekly Reports"
        subtitle="What each student said about their own week, beside what their coach said about it. Flags, streaks and silences are worked out from the submissions - nothing here is typed in twice."
      />

      <EngineOffNotice engines={engines} canOpenConsole={session.role === "ADMIN"} />

      {board.cohorts.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={20} />}
          title="No cohorts to report on"
          body="You are not running any active cohort yet. Once you are, each one gets a weekly report of its own."
          action={
            <SectionLink href="/batches" sectionKey="batches">
              <Btn>Open Batches &amp; Plans</Btn>
            </SectionLink>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Reports in"
              value={board.cycle ? `${totals.submitted} of ${totals.roster}` : "-"}
              secondary={rate !== null && board.cycle ? `${rate}% of the cohort` : undefined}
              signal={rate === null ? undefined : rate >= 80 ? "ok" : rate >= 50 ? "watch" : "risk"}
              tooltip="How many students on this cohort have submitted this week's report."
              detail={{
                title: "This week's submissions",
                rows: [
                  { label: "Submitted", value: totals.submitted },
                  { label: "Still missing", value: totals.missing },
                  { label: "Came in late", value: totals.late },
                ],
              }}
            />
            <MetricCard
              label="Red flags"
              value={totals.red}
              signal={totals.red > 0 ? "risk" : "ok"}
              tooltip="Students whose record has crossed a red line - two missed reports in a row, no applications for two weeks, or a whole ghost window of silence."
              detail={{
                title: "Flags on this cohort",
                rows: [
                  { label: "Green", value: totals.green },
                  { label: "Yellow", value: totals.yellow },
                  { label: "Red", value: totals.red },
                ],
              }}
            />
            {/*
              Null, not zero, when no question on this cohort's form is countable - a German Note
              class is not asked about applications, and a 0 here would read as a collapse in
              activity rather than as a question nobody was asked.
            */}
            <MetricCard
              label="Applications this week"
              value={totals.applications ?? "Not asked"}
              tooltip="The cohort's own total of applications sent, as reported by the students themselves."
            />
            <MetricCard
              label="Interviews this week"
              value={totals.interviews ?? "Not asked"}
              signal={totals.interviews && totals.interviews > 0 ? "ok" : undefined}
              tooltip="Interviews the students reported this week. Any call with a company about a role counts."
            />
          </div>

          <Tabs
            urlKey="tab"
            tabs={[
              {
                label: "This week",
                content: <WeeklyDesk board={board} />,
              },
              {
                label:
                  attention.rows.length > 0
                    ? `Needs attention (${attention.rows.length})`
                    : "Needs attention",
                content: <WeeklyAttention rows={attention.rows} />,
              },
              {
                label: "Weekly pulse",
                content: <WeeklyPulse weeks={pulse} />,
              },
              {
                label: "History",
                content: (
                  <Card
                    title={board.selected ? `${board.selected.name} - week by week` : "History"}
                    subtitle="Every week this cohort has been asked about, and what each student said."
                  >
                    <WeeklyHistory board={board} />
                  </Card>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
