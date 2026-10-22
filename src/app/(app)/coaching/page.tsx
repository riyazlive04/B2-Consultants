import Link from "next/link";
import { CalendarRange, ClipboardCheck, GraduationCap, School, Users, Video } from "lucide-react";
import { requireSection } from "@/lib/rbac";
import { getCoachingDesk } from "@/server/coaching-desk";
import { SessionList } from "./_components/TeachingSessions";
import { Tabs } from "@/components/ui/Tabs";
import { MetricCard } from "@/components/ui/MetricCard";
import { Card, EmptyState, PageHeader, Pill, TableShell, Td, Th, Tr } from "@/components/ui/kit";
import { StudentName } from "@/components/ui/StudentName";
import { SignalBadge } from "@/components/ui/SignalBadge";
import { formatDate } from "@/lib/format";
import { MILESTONE_LABELS } from "@/lib/labels";

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
  const desk = await getCoachingDesk(session);

  const totalStudents = desk.batches.reduce((a, b) => a + b.filled, 0);
  const registersDue = desk.needsRegister.length;
  const recordingsDue = desk.batches.reduce((a, b) => a + b.recordingsOutstanding, 0);
  const sprintDue = desk.students.filter((s) => s.sprintWeekDue).length;

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
      />

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
            content:
              desk.students.length === 0 ? (
                <EmptyState
                  title="No students assigned to you"
                  body="A student appears here once their enrollment names you as their coach."
                />
              ) : (
                <div className="space-y-3">
                  {sprintDue > 0 && (
                    <p className="rounded-field bg-surface-2 px-3 py-2 text-xs text-ink-2">
                      {sprintDue} sprint check-in{sprintDue === 1 ? "" : "s"} waiting on you - record the week&apos;s
                      actual on the student&apos;s record.
                    </p>
                  )}
                  <TableShell
                    head={
                      <>
                        <Th>Student</Th>
                        <Th>Programme</Th>
                        <Th>Milestone</Th>
                        <Th>Attendance</Th>
                        <Th>Coursework</Th>
                        <Th>Sprint check-in</Th>
                      </>
                    }
                    minWidth={820}
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
                          <Td>
                            {s.sprintWeekDue ? (
                              <span className="text-warn">
                                Week {s.sprintWeekDue.weekIndex}
                                <span className="block text-caption text-muted">
                                  by {formatDate(s.sprintWeekDue.weekEnd)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </>
                  </TableShell>
                </div>
              ),
          },
        ]}
      />

      <p className="flex items-center gap-1.5 text-caption text-muted">
        <GraduationCap size={12} aria-hidden />
        Seating, money and the full student record stay on the Students board.
      </p>
    </div>
  );
}
