import Link from "next/link";
import {
  BookOpen, CalendarClock, ClipboardList, ExternalLink, FileSignature, Flag, LayoutGrid,
  Target, Users,
} from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getMyStudentPortal } from "@/server/student-portal";
import { getMyClassroom } from "@/server/student-classroom";
import { getMyAgreements } from "@/server/student-agreements";
import { getMyPayments } from "@/server/student-payments";
import { getMyOpenCheckIns } from "@/server/attendance-checkin";
import { getMyAbsenceQuestions } from "@/server/catch-up";
import { DashboardTasks } from "./_components/DashboardTasks";
import { CheckInCard } from "@/components/attendance/CheckInCard";
import { AbsenceQuestionCard } from "@/components/attendance/AbsenceQuestionCard";
import { ResourceList } from "@/components/resources/ResourceList";
import { JourneyRing, MomentumChip } from "@/components/ui/gamification";
import { Card, PageHeader, Pill, ProgressBar } from "@/components/ui/kit";
import { DAY_NAMES, formatDuration } from "@/lib/curriculum";
import { alertCountdown } from "@/lib/class-reminder";
import { formatDate } from "@/lib/format";
import { MILESTONE_LABELS } from "@/lib/labels";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * THE STUDENT'S HOME.
 *
 * ── Why a third student page, and not more sections on My Journey ───────────────────────
 * The portal had two screens and no front door. My Journey is a SCOREBOARD - how far have I
 * come, opened once a week. My Classroom is a TIMETABLE - what is on, opened before a class.
 * Neither answers the question someone actually has when they sign in, which is "what do I need
 * to do now", and a student arriving on a gamified ring had to work out for themselves which of
 * the two other pages held the answer.
 *
 * So this page is strictly a LANDING: next class, what is outstanding, how I am doing, where
 * everything is. It owns no data of its own - every section is a summary of a page that holds
 * the detail, and links to it. Nothing here can disagree with those pages, because it is reading
 * the same four functions they read.
 */
export default async function StudentDashboardPage() {
  const session = await requireSection("dashboard");
  const [portal, classroom, agreements, payments, checkIns, absenceQuestions] = await Promise.all([
    getMyStudentPortal(session.user.id),
    getMyClassroom(session.user.id),
    getMyAgreements(session.user.id),
    getMyPayments(session.user.id),
    getMyOpenCheckIns(session.user.id),
    getMyAbsenceQuestions(session.user.id),
  ]);

  const firstName = (portal?.fullName ?? session.user.name ?? "there").split(" ")[0];

  if (!portal && !classroom) {
    return (
      <div className="w-full space-y-6">
        <PageHeader icon={<LayoutGrid size={20} />} title="Dashboard" />
        <Card>
          <p className="text-sm text-muted">
            Your login isn&apos;t linked to a student record yet - ask your coach to connect it.
          </p>
        </Card>
      </div>
    );
  }

  const e = portal?.primary ?? null;
  const next = classroom?.next ?? null;

  /**
   * Everything still owed, across every class and every batch - which is a view neither other
   * page offers: the classroom lists coursework UNDER its class, so three outstanding tasks
   * from three weeks are three separate places to look.
   */
  const outstanding = (classroom?.batches ?? []).flatMap((b) =>
    b.sessions.flatMap((s) =>
      s.tasks
        .filter((t) => t.status !== "YES")
        .map((t) => ({ ...t, context: `${s.title}${classroom!.batches.length > 1 ? ` · ${b.name}` : ""}` })),
    ),
  );

  const attended = (classroom?.batches ?? []).reduce((a, b) => a + b.attended, 0);
  const counted = (classroom?.batches ?? []).reduce((a, b) => a + b.counted, 0);
  const tasksDone = (classroom?.batches ?? []).reduce((a, b) => a + b.tasksDone, 0);
  const tasksTotal = (classroom?.batches ?? []).reduce((a, b) => a + b.tasksTotal, 0);
  const attendancePct = counted > 0 ? Math.round((attended / counted) * 100) : null;
  const taskPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : null;

  // The sprint week whose window is open - the one thing a student is asked to fill in.
  const sprintWeek = e?.sprintWeeks.find((w) => w.isCurrent) ?? null;
  const unsignedAgreement = agreements.find((a) => !a.signedAt) ?? null;
  const resources = (classroom?.batches ?? []).flatMap((b) => b.resources).slice(0, 5);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<LayoutGrid size={20} />}
        title={`Hi ${firstName}`}
        subtitle={
          e
            ? `${e.programLevel}${e.dayNumber && e.totalDays ? ` · day ${e.dayNumber} of ${e.totalDays}` : ""}${
                portal?.targetRole ? ` · aiming for ${portal.targetRole} in Germany` : ""
              }`
            : "Your classes, coursework and progress."
        }
      />

      {/*
        ── 0. ATTENDANCE IS OPEN - above even the next class ──
        This is the only thing on the page with a deadline measured in minutes. Everything
        below it will still be true in an hour; this will not. It renders nothing at all when
        no window is open, which is almost always.
      */}
      <CheckInCard checkIns={checkIns} />

      {/*
        A coach has asked a direct question about a specific absence. Rare by construction -
        nothing asks unless a coach pressed "Ask why" - and therefore worth interrupting for.
        Renders nothing the rest of the time.
      */}
      <AbsenceQuestionCard questions={absenceQuestions} />

      {/* ── 1. The next thing that happens ── */}
      {next ? (
        <Card>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2">
              <CalendarClock size={18} className="text-primary" aria-hidden />
              <span className="text-label font-semibold uppercase text-ink-2">Next class</span>
            </span>
            <div className="min-w-[200px] flex-1">
              <p className="font-display text-[17px] font-semibold text-ink">{next.session.title}</p>
              <p className="text-sm text-ink-2">
                {DAY_NAMES[new Date(`${next.session.dateYmd}T00:00:00Z`).getUTCDay()]}{" "}
                {formatDate(next.session.dateYmd)}
                {next.session.timeHm ? ` · ${next.session.timeHm} IST` : " · time to be confirmed"}
                {formatDuration(next.session.durationMins) ? ` · ${formatDuration(next.session.durationMins)}` : ""}
                {" · "}
                {alertCountdown(new Date(next.session.startsAt), new Date())}
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
            <Link
              href="/classroom"
              className="press inline-flex h-9 items-center rounded-field border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-surface-2"
            >
              Timetable
            </Link>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted">
            No class scheduled right now.{" "}
            <Link href="/classroom" className="font-medium text-primary hover:underline">
              See your timetable
            </Link>
            .
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* ── 2. What is owed ── */}
          <Card title={`To do${outstanding.length ? ` (${outstanding.length})` : ""}`}>
            {outstanding.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing outstanding - every piece of coursework is ticked off. Nice.
              </p>
            ) : (
              <DashboardTasks tasks={outstanding} />
            )}
          </Card>

          {/* ── 3. The sprint check-in, only while its window is open ── */}
          {sprintWeek && (
            <Card title={`Sprint week ${sprintWeek.weekIndex}`}>
              <p className="text-sm text-ink-2">
                {sprintWeek.target ? sprintWeek.target : "Your coach has not set this week's target yet."}
              </p>
              <p className="mt-1 text-caption text-muted">
                Check in by {formatDate(sprintWeek.weekEnd)}.{" "}
                <Link href="/my-journey" className="font-medium text-primary hover:underline">
                  Submit your check-in
                </Link>
              </p>
            </Card>
          )}

          {/* ── 4. Material ── */}
          {resources.length > 0 && (
            <Card title="Your resources">
              <ResourceList resources={resources} />
              <Link
                href="/classroom"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                All class material <ExternalLink size={13} aria-hidden />
              </Link>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* ── 5. How it is going ── */}
          {e && (
            <Card title="Your progress">
              <div className="flex items-center gap-4">
                <JourneyRing pct={e.journey.journeyPct} stageIndex={e.journey.stageIndex} size={64} />
                <div className="min-w-0">
                  <p className="font-display text-[15px] font-semibold text-ink">
                    {MILESTONE_LABELS[e.currentMilestone as keyof typeof MILESTONE_LABELS] ?? e.currentMilestone}
                  </p>
                  {/* Null momentum means "not enough activity to judge yet" - a real state,
                      and not the same as a cold flame. Show nothing rather than a verdict. */}
                  {e.journey.momentum && <MomentumChip momentum={e.journey.momentum} size="sm" />}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {attendancePct !== null && (
                  <div>
                    <p className="flex items-center justify-between text-caption text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <Users size={12} aria-hidden /> Attendance
                      </span>
                      <span>{attended}/{counted}</span>
                    </p>
                    <ProgressBar
                      pct={attendancePct}
                      tone={attendancePct >= 75 ? "good" : attendancePct >= 50 ? "warn" : "bad"}
                    />
                  </div>
                )}
                {taskPct !== null && (
                  <div>
                    <p className="flex items-center justify-between text-caption text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <ClipboardList size={12} aria-hidden /> Coursework
                      </span>
                      <span>{tasksDone}/{tasksTotal}</span>
                    </p>
                    <ProgressBar pct={taskPct} tone={taskPct >= 75 ? "good" : taskPct >= 50 ? "warn" : "bad"} />
                  </div>
                )}
                <p className="flex items-center justify-between text-caption text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Target size={12} aria-hidden /> Applications · interviews
                  </span>
                  <span className="text-ink">
                    {e.applicationsSubmitted} · {e.interviewsReceived}
                  </span>
                </p>
              </div>
              <Link
                href="/my-journey"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                My Journey <ExternalLink size={13} aria-hidden />
              </Link>
            </Card>
          )}

          {/* ── 6. Admin a student can be blocked by ── */}
          {(unsignedAgreement || payments.hasAny) && (
            <Card title="Your paperwork">
              {unsignedAgreement && (
                <p className="flex items-center gap-2 text-sm">
                  <FileSignature size={15} className="text-warn" aria-hidden />
                  <span className="text-ink">Your agreement is waiting for your signature.</span>
                </p>
              )}
              {!unsignedAgreement && agreements.length > 0 && (
                <p className="flex items-center gap-2 text-sm">
                  <FileSignature size={15} className="text-good" aria-hidden />
                  <span className="text-ink-2">Agreement signed.</span>
                </p>
              )}
              {payments.hasAny && (
                <p className="mt-1 text-caption text-muted">
                  Payment plan, balance and receipts are on My Journey.
                </p>
              )}
              <Link
                href="/my-journey"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open <ExternalLink size={13} aria-hidden />
              </Link>
            </Card>
          )}

          {/* ── 7. Where everything is ── */}
          <Card title="Jump to">
            <ul className="space-y-1.5 text-sm">
              <li>
                <Link href="/classroom" className="inline-flex items-center gap-2 text-ink hover:underline">
                  <CalendarClock size={14} className="text-primary" aria-hidden /> My Classroom
                </Link>
              </li>
              <li>
                <Link href="/my-journey" className="inline-flex items-center gap-2 text-ink hover:underline">
                  <Flag size={14} className="text-primary" aria-hidden /> My Journey
                </Link>
              </li>
              <li>
                <Link href="/guide" className="inline-flex items-center gap-2 text-ink hover:underline">
                  <BookOpen size={14} className="text-primary" aria-hidden /> App Guide
                </Link>
              </li>
            </ul>
            {classroom && classroom.batches.length > 0 && (
              <p className="mt-3 text-caption text-muted">
                {classroom.batches.map((b) => b.name).join(" · ")}
                {classroom.batches[0]?.coachName ? ` · Coach: ${classroom.batches[0].coachName}` : ""}
              </p>
            )}
          </Card>
        </div>
      </div>

      {e?.status && e.status !== "ACTIVE" && (
        <Pill tone="neutral">Your enrolment is {e.status.toLowerCase()}</Pill>
      )}
    </div>
  );
}
