import Link from "next/link";
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  ExternalLink,
  FileDown,
  Users,
} from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getMyClassroom, type ClassroomBatchView } from "@/server/student-classroom";
import { getMyOpenCheckIns } from "@/server/attendance-checkin";
import { CheckInCard } from "@/components/attendance/CheckInCard";
import { ClassroomTimetable } from "./_components/ClassroomTimetable";
import { Tabs } from "@/components/ui/Tabs";
import { Card, PageHeader, Pill, ProgressBar } from "@/components/ui/kit";
import { DAY_NAMES, formatDuration } from "@/lib/curriculum";
import { formatDate } from "@/lib/format";

export const metadata = { title: "My Classroom" };
export const dynamic = "force-dynamic";

/**
 * The student's classroom: the timetable, the join links, the recordings and their coursework.
 *
 * Deliberately a SECOND student page rather than more sections on My Journey. The two answer
 * different questions at different cadences - My Journey is "how far have I come", opened once
 * a week; this is "what is on and what do I owe", opened before every class. Folding the
 * timetable into the scoreboard would have buried the one time-critical thing the portal does.
 */
export default async function ClassroomPage() {
  const session = await requireSection("classroom");
  const [classroom, checkIns] = await Promise.all([
    getMyClassroom(session.user.id),
    getMyOpenCheckIns(session.user.id),
  ]);

  if (!classroom) {
    return (
      <div className="w-full space-y-6">
        <PageHeader icon={<CalendarDays size={20} />} title="My Classroom" />
        <Card>
          <p className="text-sm text-muted">
            Your login isn&apos;t linked to a student record yet - ask your coach to connect it.
          </p>
        </Card>
      </div>
    );
  }

  if (classroom.batches.length === 0) {
    return (
      <div className="w-full space-y-6">
        <PageHeader
          icon={<CalendarDays size={20} />}
          title="My Classroom"
          subtitle={`${classroom.fullName} · your classes, recordings and coursework.`}
        />
        <Card>
          <p className="text-sm text-muted">
            You haven&apos;t been seated in a batch yet. Your timetable appears here the moment your
            cohort opens - your coach will confirm the dates with you.
          </p>
          <Link href="/my-journey" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            See My Journey <ExternalLink size={13} aria-hidden />
          </Link>
        </Card>
      </div>
    );
  }

  const next = classroom.next;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<CalendarDays size={20} />}
        title="My Classroom"
        subtitle={`${classroom.fullName} · your classes, recordings and coursework.`}
      />

      {/* An open register outranks even the next class - it is the only thing here with a
          deadline in minutes. Renders nothing when no window is open, which is most of the time. */}
      <CheckInCard checkIns={checkIns} />

      {/* The one thing this page exists to answer, above everything else. */}
      {next && (
        <Card>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2">
              <CalendarClock size={18} className="text-primary" aria-hidden />
              <span className="text-label font-semibold uppercase text-ink-2">Next up</span>
            </span>
            <div className="min-w-[200px] flex-1">
              <p className="font-display text-[17px] font-semibold text-ink">{next.session.title}</p>
              <p className="text-sm text-ink-2">
                {DAY_NAMES[new Date(`${next.session.dateYmd}T00:00:00Z`).getUTCDay()]}{" "}
                {formatDate(next.session.dateYmd)}
                {next.session.timeHm ? ` · ${next.session.timeHm} IST` : " · time to be confirmed"}
                {formatDuration(next.session.durationMins) ? ` · ${formatDuration(next.session.durationMins)}` : ""}
                {classroom.batches.length > 1 ? ` · ${next.batch.name}` : ""}
              </p>
            </div>
            {next.session.joinUrl && (
              <a
                href={next.session.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-btn bg-primary px-4 py-2 text-sm font-semibold text-[color:var(--on-accent)] hover:opacity-90"
              >
                <ExternalLink size={15} aria-hidden /> Join class
              </a>
            )}
          </div>
        </Card>
      )}

      {/* One batch is the normal case and gets no tab bar; a student repeating a level, or on
          both a coaching programme and a German course, gets one tab per cohort. */}
      {classroom.batches.length === 1 ? (
        <BatchBlock batch={classroom.batches[0]} />
      ) : (
        <Tabs
          urlKey="batch"
          tabs={classroom.batches.map((b) => ({ label: b.name, content: <BatchBlock batch={b} /> }))}
        />
      )}
    </div>
  );
}

function BatchBlock({ batch }: { batch: ClassroomBatchView }) {
  const attendancePct = batch.counted > 0 ? Math.round((batch.attended / batch.counted) * 100) : null;
  const taskPct = batch.tasksTotal > 0 ? Math.round((batch.tasksDone / batch.tasksTotal) * 100) : null;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-[180px] flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-display text-[15px] font-semibold text-ink">{batch.name}</span>
              {batch.code && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{batch.code}</span>
              )}
              <Pill tone="info">{batch.level}</Pill>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {batch.coachName ? `${batch.line === "B2" ? "Coach" : "Tutor"}: ${batch.coachName}` : "Coach to be confirmed"}
              {batch.classmates > 0 ? ` · ${batch.classmates} other${batch.classmates === 1 ? "" : "s"} in your batch` : ""}
              {batch.curriculumName ? ` · ${batch.curriculumName}` : ""}
            </p>
          </div>

          {/* Only shown once there is something to report. A 0% attendance bar on day one is a
              demoralising lie - no register has been taken yet. */}
          {attendancePct !== null && (
            <div className="w-[150px]">
              <p className="flex items-center gap-1.5 text-label font-semibold uppercase text-ink-2">
                <Users size={12} aria-hidden /> Attendance
              </p>
              <p className="text-sm text-ink">{batch.attended} of {batch.counted} classes</p>
              <ProgressBar pct={attendancePct} tone={attendancePct >= 75 ? "good" : attendancePct >= 50 ? "warn" : "bad"} />
            </div>
          )}
          {taskPct !== null && (
            <div className="w-[150px]">
              <p className="flex items-center gap-1.5 text-label font-semibold uppercase text-ink-2">
                <ClipboardList size={12} aria-hidden /> Coursework
              </p>
              <p className="text-sm text-ink">{batch.tasksDone} of {batch.tasksTotal} done</p>
              <ProgressBar pct={taskPct} tone={taskPct >= 75 ? "good" : taskPct >= 50 ? "warn" : "bad"} />
            </div>
          )}
        </div>

        {/*
          THE TIMETABLE AS A DOCUMENT (@15:36, @16:33), and as a calendar.
          Two answers to two different questions: the PDF is the one you print or forward and
          plan a month against, the .ics is the one that lands in your phone and survives a
          class being moved. Plain links, not buttons - both are GETs that download a file.
          Neither carries a join link; see the note in documents/timetable-pdf.tsx.
        */}
        {batch.sessions.length > 0 && (
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
            <a
              href={`/api/classroom/timetable/${batch.id}`}
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              <FileDown size={14} aria-hidden /> Timetable as PDF
            </a>
            <a
              href={`/api/classroom/timetable/${batch.id}?format=ics`}
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              <CalendarPlus size={14} aria-hidden /> Add to my calendar
            </a>
            <span className="text-caption text-muted">
              Join links stay in the app - these files get forwarded.
            </span>
          </p>
        )}
      </Card>

      <ClassroomTimetable batch={batch} />
    </div>
  );
}
