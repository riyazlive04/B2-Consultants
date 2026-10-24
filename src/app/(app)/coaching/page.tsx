import Link from "next/link";
import { CalendarRange, ClipboardCheck, GraduationCap, Languages, School, Users, Video } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getCoachingDesk } from "@/server/coaching-desk";
import { getAttendanceBoard } from "@/server/attendance-board";
import { getStudentLifecycleConfig } from "@/server/founder-config";
import { SessionList } from "./_components/TeachingSessions";
import { DiscontinueButton, RestoreButton } from "./_components/DiscontinueStudent";
import { Tabs } from "@/components/ui/Tabs";
import { MetricCard } from "@/components/ui/MetricCard";
import { Card, EmptyState, PageHeader, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { SectionLink } from "@/components/ui/SectionLink";
import { StudentName } from "@/components/ui/StudentName";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { formatDate } from "@/lib/format";
import { MILESTONE_LABELS } from "@/lib/labels";
import { isConcerning } from "@/lib/sprint-check-in";

export const metadata = { title: "My Teaching" };
export const dynamic = "force-dynamic";

/**
 * The teaching desk - one screen for a B2 coach and a German Note tutor alike.
 *
 * Gated on the `coaching` section rather than on a role, so the founder can hand it to (or take
 * it from) a person in Console → Sections. The desk SCOPES ITSELF: `getCoachingDesk` only ever
 * returns the cohorts you lead and the students you coach, so granting the section to someone
 * who teaches nothing shows them an honest empty desk rather than somebody else's week.
 */
export default async function CoachingPage() {
  const session = await requireSection("coaching");
  /*
    The desk and the reason vocabulary are read together: the picker inside the discontinue
    dialog is filled from the Console's list, and a dialog offering reasons the server would
    then refuse is worse than no dialog.
  */
  const [desk, lifecycle, attendance] = await Promise.all([
    getCoachingDesk(session),
    getStudentLifecycleConfig(),
    /*
      ── THE PUBLISH GATE, SAID OUT LOUD ON THIS SCREEN (P10) ──────────────────────────────
      Marking a register is private; PUBLISHING it is what makes it count - it fires the absence
      notices and moves every attendance percentage. A marked, unpublished register therefore
      looks on this screen exactly like a class nobody taught, and this is the screen a coach
      actually lives on. The register desk already derives the list; it is `cache()`d and scoped
      to this viewer's own cohorts, so reading it here costs one query and no new rule.
    */
    getAttendanceBoard(session),
  ]);

  const totalStudents = desk.batches.reduce((a, b) => a + b.filled, 0);
  const registersDue = desk.needsRegister.length;
  const recordingsDue = desk.batches.reduce((a, b) => a + b.recordingsOutstanding, 0);
  /*
    Two counts, because they are two different jobs.
    `awaitingMe` is the coach's own queue - a week the student answered whose prose target left
    the verdict to a human, finished in ten seconds. `chasing` is students who have not answered
    at all, which is a conversation rather than a chore. The banner used to add them together
    and call the total "waiting on you", so a coach working their queue found half of it was not
    theirs to action.
  */
  const awaitingMe = desk.students.filter((s) => s.sprintWeekDue?.state === "AWAITING_COACH").length;
  const chasing = desk.students.filter((s) => s.sprintWeekDue?.state === "OVERDUE").length;
  const concerning = desk.students.filter((s) => isConcerning(s.unansweredStreak)).length;
  /**
   * Registers marked but never published - work that is done and counting for nothing.
   *
   * Zeroed when the founder has switched the publish step OFF in Console → Attendance: with it
   * off, marks are visible to students the moment they are taken, so there is nothing withheld
   * and a banner would be telling a coach to go and do something that no longer exists.
   */
  const unpublished = attendance.publishRequired ? attendance.unpublished.length : 0;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<School size={20} />}
        title="My Teaching"
        subtitle={
          desk.seesAllBatches
            ? desk.supervising
              ? "Every active cohort - you are not assigned to one, so this is the supervisor's view."
              : "Every active cohort, yours marked as such - plus the students you coach."
            : "The cohorts you run and the students you coach."
        }
        actions={
          /*
            THE OTHER TEACHING HOME (P17).

            A tutor has two: this one, and German Note. Neither linked to the other, so which
            screen does what was something you learned by trial - and a German Note tutor landing
            here saw an empty desk with no hint that their batches live elsewhere. `SectionLink`
            renders nothing for somebody without the section, so a B2-only coach is not offered a
            door that would refuse them.
          */
          <SectionLink href="/german-note" sectionKey="german-note">
            <Languages size={14} /> German Note classes
          </SectionLink>
        }
      />

      {unpublished > 0 && (
        <div className="rounded-card border border-warn-soft bg-warn-soft/40 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            {unpublished} register{unpublished === 1 ? "" : "s"} {unpublished === 1 ? "is" : "are"} marked but not published
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            Marking is private. Publishing is what tells the students, fires the absence notices
            and moves everyone&apos;s attendance percentage - until then the class counts for
            nothing.{" "}
            <Link href="/attendance" className="font-semibold text-primary hover:underline">
              Publish them on the register desk
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active cohorts"
          value={desk.batches.length}
          icon={<CalendarRange size={18} />}
          detail={{ rows: desk.batches.map((b) => ({ label: b.name, value: `${b.filled}/${b.targetStrength}` })) }}
        />
        <MetricCard
          label="Students in them"
          value={totalStudents}
          icon={<Users size={18} />}
          detail={{ rows: desk.batches.map((b) => ({ label: b.name, value: b.filled })) }}
        />
        <MetricCard
          label="Registers to take"
          value={registersDue}
          signal={registersDue > 0 ? "watch" : "ok"}
          icon={<ClipboardCheck size={18} />}
          detail={{
            rows: desk.needsRegister.slice(0, 8).map((s) => ({ label: s.title, value: formatDate(s.dateYmd) })),
          }}
        />
        <MetricCard
          label="Recordings to post"
          value={recordingsDue}
          signal={recordingsDue > 0 ? "watch" : "ok"}
          icon={<Video size={18} />}
          detail={{
            rows: desk.batches
              .filter((b) => b.recordingsOutstanding > 0)
              .map((b) => ({ label: b.name, value: b.recordingsOutstanding })),
          }}
        />
      </div>

      <Tabs
        urlKey="tab"
        tabs={[
          {
            label: `This week${desk.upcoming.length ? ` (${desk.upcoming.length})` : ""}`,
            content: (
              <SessionList
                sessions={desk.upcoming}
                emptyTitle="Nothing scheduled in the next seven days"
                emptyBody="Classes appear here as soon as a cohort's timetable is built."
              />
            ),
          },
          {
            label: `To mark${registersDue ? ` (${registersDue})` : ""}`,
            content: (
              <SessionList
                sessions={desk.needsRegister}
                emptyTitle="Every register is taken"
                emptyBody="Classes you have taught but not yet marked show up here."
              />
            ),
          },
          {
            label: `Cohorts${desk.batches.length ? ` (${desk.batches.length})` : ""}`,
            content:
              desk.batches.length === 0 ? (
                <EmptyState
                  title="No cohorts yet"
                  body="You will see a batch here as soon as you are assigned to run one."
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {desk.batches.map((b) => (
                    <Card key={b.id}>
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <Link href={b.href} className="font-display text-[15px] font-semibold text-ink hover:underline">
                            {b.name}
                          </Link>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            {b.code && (
                              <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">{b.code}</span>
                            )}
                            <span>{b.level}</span>
                            <span>·</span>
                            <span>{b.filled}/{b.targetStrength} seated</span>
                          </p>
                        </div>
                        <Pill tone={b.line === "B2" ? "primary" : "info"}>
                          {b.line === "B2" ? "Coaching" : "German Note"}
                        </Pill>
                        {/* Whose class it is, rather than merely that it is not yours - the
                            useful half of the same fact on a desk showing every classroom. */}
                        {!b.iLead && (
                          <Pill tone="neutral">{b.leadName ? `Led by ${b.leadName}` : "No coach assigned"}</Pill>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-ink-2">
                        {b.sessionCount > 0
                          ? `${b.sessionCount} session${b.sessionCount === 1 ? "" : "s"}`
                          : "No timetable yet"}
                        {b.curriculumName ? ` · ${b.curriculumName}` : ""}
                        {b.nextSessionAt ? ` · next ${formatDate(b.nextSessionAt)}` : ""}
                      </p>
                      {(b.registersOutstanding > 0 || b.recordingsOutstanding > 0) && (
                        <p className="mt-1 text-caption text-warn">
                          {b.registersOutstanding > 0 && `${b.registersOutstanding} register${b.registersOutstanding === 1 ? "" : "s"} to take`}
                          {b.registersOutstanding > 0 && b.recordingsOutstanding > 0 && " · "}
                          {b.recordingsOutstanding > 0 && `${b.recordingsOutstanding} recording${b.recordingsOutstanding === 1 ? "" : "s"} to post`}
                        </p>
                      )}
                      {b.sprintStartDate && (
                        <p className="mt-1 text-caption text-muted">Sprint from {formatDate(b.sprintStartDate)}</p>
                      )}
                    </Card>
                  ))}
                </div>
              ),
          },
          {
            label: `My students${desk.students.length ? ` (${desk.students.length})` : ""}`,
            /*
              The empty state no longer swallows the whole tab.
              A coach whose last student has just stopped has an EMPTY caseload and the most
              urgent reason to be here - the undo. So the departures panel sits outside that
              branch; only the table has an empty state of its own.
            */
            content: (
                <div className="space-y-3">
                  {desk.students.length === 0 && (
                    <EmptyState
                      title="No students assigned to you"
                      body="A student appears here once their enrollment names you as their coach."
                    />
                  )}
                  {desk.students.length > 0 && (awaitingMe > 0 || chasing > 0) && (
                    <p className="rounded-field bg-surface-2 px-3 py-2 text-xs text-ink-2">
                      {awaitingMe > 0 && (
                        <>
                          {awaitingMe} check-in{awaitingMe === 1 ? "" : "s"} waiting on your verdict - record the
                          week&apos;s actual on the student&apos;s record.
                        </>
                      )}
                      {awaitingMe > 0 && chasing > 0 && " "}
                      {chasing > 0 && (
                        <>
                          {chasing} student{chasing === 1 ? " has" : "s have"} not filled theirs in
                          {concerning > 0 && `, ${concerning} for three weekends or more`}.
                        </>
                      )}
                    </p>
                  )}
                  {desk.students.length > 0 && (
                  <TableShell
                    head={
                      <>
                        <Th>Student</Th>
                        <Th>Programme</Th>
                        <Th>Milestone</Th>
                        <Th>Attendance</Th>
                        <Th>Coursework</Th>
                        <Th>Sprint check-in</Th>
                        <Th />
                      </>
                    }
                    minWidth={940}
                  >
                    <>
                      {desk.students.map((s) => (
                        <Tr key={s.enrollmentId}>
                          <Td>
                            <Link href={`/students/${s.studentId}`} className="hover:underline">
                              <StudentName name={s.name} code={s.code} />
                            </Link>
                            {s.batchName && <span className="block text-caption text-muted">{s.batchName}</span>}
                          </Td>
                          <Td>
                            <span className="inline-flex items-center gap-1.5">
                              {s.programLevel}
                              {/* `Enrollment.signalColour` is the coach's manual GREEN/AMBER/RED,
                                  a different scale from the badge's ok/watch/risk. Map it rather
                                  than casting - the two agree in meaning, not in spelling. */}
                              {s.signalColour && (
                                <SignalBadge
                                  level={s.signalColour === "RED" ? "risk" : s.signalColour === "AMBER" ? "watch" : "ok"}
                                />
                              )}
                            </span>
                          </Td>
                          <Td>{MILESTONE_LABELS[s.currentMilestone as keyof typeof MILESTONE_LABELS] ?? s.currentMilestone}</Td>
                          <Td>
                            {s.attendancePct === null ? (
                              <span className="text-muted">-</span>
                            ) : (
                              <span className={s.attendancePct < 50 ? "text-risk" : s.attendancePct < 75 ? "text-warn" : "text-ink-2"}>
                                {s.attendancePct}%
                              </span>
                            )}
                          </Td>
                          <Td>
                            {s.tasksPending > 0 ? (
                              <span className="text-warn">{s.tasksPending} outstanding</span>
                            ) : (
                              <span className="text-muted">Clear</span>
                            )}
                          </Td>
                          {/*
                            WHOSE move it is, said in the cell. "Week 4" alone left the coach to
                            work out whether that was theirs to judge or the student's to answer,
                            and the two need opposite responses.
                          */}
                          <Td>
                            {s.sprintWeekDue ? (
                              <span
                                className={
                                  s.sprintWeekDue.state === "AWAITING_COACH"
                                    ? "text-primary"
                                    : s.sprintWeekDue.state === "OVERDUE"
                                      ? "text-warn"
                                      : "text-ink-2"
                                }
                              >
                                Week {s.sprintWeekDue.weekIndex}
                                <span className="block text-caption text-muted">
                                  {s.sprintWeekDue.state === "AWAITING_COACH"
                                    ? "your verdict"
                                    : s.sprintWeekDue.state === "OVERDUE"
                                      ? `unanswered since ${formatDate(s.sprintWeekDue.weekEnd)}`
                                      : `open until ${formatDate(s.sprintWeekDue.weekEnd)}`}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                            {/*
                              The end of the ladder, and it stops here - at a pill, next to the
                              button, in front of the person who decides. The founders were
                              explicit that the stage move stays manual (@37:54).
                            */}
                            {isConcerning(s.unansweredStreak) && (
                              <Pill tone="bad">
                                {s.unansweredStreak} weekends silent
                              </Pill>
                            )}
                          </Td>
                          {/*
                            `canDiscontinue` is decided per ROW on the server, not once for the
                            desk: a supervisor sees every active enrolment here, and seeing a
                            caseload is not the right to end someone else's student's programme.
                          */}
                          <Td align="right">
                            {s.canDiscontinue && (
                              <DiscontinueButton
                                enrollmentId={s.enrollmentId}
                                studentName={s.name}
                                reasons={lifecycle.discontinueReasons}
                                allowOther={lifecycle.allowOtherReason}
                              />
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </>
                  </TableShell>
                  )}

                  {/*
                    THE UNDO. A discontinued enrolment leaves the caseload above the instant it
                    is saved, so without this list a coach who pressed the wrong row had nowhere
                    to go - the student had vanished from the only screen they can reach.

                    The reason is printed next to each name because reversing one is a judgement:
                    "put them back" reads very differently beside "found a job elsewhere" than
                    beside "unresponsive - no contact".
                  */}
                  {desk.recentDepartures.length > 0 && (
                    <Card
                      title="Recently stopped"
                      subtitle="Discontinued in the last 30 days. After that, the Students board is the place."
                    >
                      <ul className="divide-y divide-line">
                        {desk.recentDepartures.map((d) => (
                          <li key={d.enrollmentId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                            <Link href={`/students/${d.studentId}`} className="hover:underline">
                              <StudentName name={d.name} code={d.code} />
                            </Link>
                            <span className="text-caption text-muted">
                              {d.programLevel} · stopped {formatDate(d.whenYmd)}
                              {d.byName ? ` by ${d.byName}` : ""}
                            </span>
                            <span className="text-sm text-ink-2">{d.reason ?? "No reason recorded"}</span>
                            {d.note && d.note !== d.reason && (
                              <span className="w-full text-caption text-muted">{d.note}</span>
                            )}
                            {d.canRestore && (
                              <span className="ml-auto">
                                <RestoreButton enrollmentId={d.enrollmentId} studentName={d.name} />
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                </div>
            ),
          },
        ]}
      />

      <p className="flex items-center gap-1.5 text-caption text-muted">
        <GraduationCap size={12} aria-hidden />
        {/* "Seating" was in this sentence until 24/10/2026, and it is no longer true: a cohort's
            Roster tab is where learners are added. Money and the full student record do still
            live on the Students board. */}
        Money and the full student record stay on the Students board; learners are added from a
        cohort&apos;s own Roster tab.
      </p>
    </div>
  );
}
