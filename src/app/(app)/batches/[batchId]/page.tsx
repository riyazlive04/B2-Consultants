import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { PageHeader, Pill, TableShell, Td, Th, Tr, EmptyState } from "@/components/ui/kit";
import { requireSession } from "@/lib/rbac";
import { resolveBackLink } from "@/lib/back-link";
import { canSeatBatch, getBatchDetail } from "@/server/batch-detail";
// "Who can be seated here" is a membership question, so it lives with the rest of them (P1).
import { listSeatCandidates } from "@/server/batch-membership";
import { SeatPicker } from "@/components/batches/SeatPicker";
import { getBatchAttendance } from "@/server/attendance";
import { listCurriculumTemplates } from "@/server/curriculum";
import { batchResources } from "@/server/resources";
import { ResourceManager } from "@/components/resources/ResourceManager";
import { TimetablePanel } from "@/components/batches/TimetablePanel";
import { BatchChecklist } from "@/components/batches/BatchChecklist";
import { StudentName } from "@/components/ui/StudentName";
import { formatPct } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * A B2 coaching cohort: its timetable and its roster.
 *
 * NOT gated on a section. The three people who need this page - the founder, the coach who runs
 * the cohort and the head coach - sit in three different section sets, and a COACH has neither
 * `students` nor `german-note`. `getBatchDetail` asks the only question that is actually about
 * access: is this your cohort. It returns null when it is not, and we bounce.
 *
 * German Note keeps its own batch screen (`/german-note/[batchId]`), which is a classroom and a
 * community feed rather than a timetable. Merging them would mean one page pretending to be two.
 */
export default async function BatchPage({
  params,
  searchParams,
}: {
  params: { batchId: string };
  searchParams?: { back?: string };
}) {
  const session = await requireSession();
  const batch = await getBatchDetail(params.batchId, session);
  if (!batch) redirect("/?denied=batch");
  // German Note cohorts are run from their own screen; land anyone who arrives here there.
  if (batch.line === "GERMAN_NOTE") redirect(`/german-note/${batch.id}`);

  /*
    MAY THIS VIEWER DECIDE WHO IS IN THE COHORT?

    A different question from `canManage`, which is about running it - building the timetable,
    taking the register. Seating is fenced on `batches.manage` for a coaching cohort and on ADMIN
    for a German Note one, read straight off the actions that will run (see `canSeatBatch`), so
    the picker is never drawn for somebody the server would then refuse.
  */
  const canSeat = await canSeatBatch(session, batch.id);

  const [attendance, templates, resources, candidates] = await Promise.all([
    getBatchAttendance(batch.id),
    // Only a manager is offered the build dialog, so only they need the catalogue loaded.
    batch.canManage ? listCurriculumTemplates({ line: "B2", activeOnly: true }) : Promise.resolve([]),
    batchResources(batch.id),
    // Up to 500 rows, so it is only fetched for somebody who can actually act on it.
    canSeat ? listSeatCandidates(batch.id) : Promise.resolve([]),
  ]);
  const sessionResourceCount =
    [...resources.bySession.values()].reduce((a, v) => a + v.length, 0) + resources.batch.length;
  const rateByStudent = new Map(attendance.map((a) => [a.studentId, a]));

  /*
    BACK GOES WHERE YOU CAME FROM, not where your role usually starts.

    Four screens link to a cohort, and this page used to answer all four with the viewer's role
    ("Students" for a founder, "My Teaching" for a coach). Opening a cohort from the register
    desk therefore stranded you: the one link on the page pointed at a list you had not been
    looking at. The origin now travels as `?back=` - a key, never a URL (see lib/back-link.ts) -
    and the role-shaped answer stays as the fallback for an arrival that carries none.
  */
  const back = resolveBackLink(
    searchParams?.back,
    session.role === "COACH" || session.role === "TUTOR"
      ? { href: "/coaching", label: "My Teaching" }
      : { href: "/students", label: "Students" },
  );

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href={back.href} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
          <ArrowLeft size={13} /> {back.label}
        </Link>
        <PageHeader
          title={batch.name}
          subtitle={`${batch.leadName ? `Coach: ${batch.leadName}` : "No coach assigned yet"}${batch.notes ? ` · ${batch.notes}` : ""}`}
          actions={
            <>
              {batch.code && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{batch.code}</span>
              )}
              <Pill tone="info">{batch.level}</Pill>
              <Pill tone={batch.capacity === "over" ? "warn" : batch.capacity === "full" ? "good" : "neutral"}>
                {batch.capacityLabel}
              </Pill>
              {batch.status === "ARCHIVED" && <Pill tone="neutral">Archived</Pill>}
            </>
          }
        />
      </div>

      {/*
        WHAT THIS COHORT STILL NEEDS, before anything else on the page.
        Derived from the row itself (see lib/batch.ts) - the `status` column only ever says
        ACTIVE or ARCHIVED, so without this a cohort with no plan, no teacher, no dates and
        nobody in it looked exactly like one that was teaching. It renders nothing once a
        complete cohort is running, so a coach's weekly screen does not carry a wall of ticks.
      */}
      <BatchChecklist
        batchId={batch.id}
        batchName={batch.name}
        line={batch.line}
        readiness={batch.readiness}
        blockers={batch.blockers}
        canManage={batch.canManage}
        /* Starting a cohort writes its start date, which `activateBatch` fences on ADMIN. */
        canActivate={session.role === "ADMIN" ? batch.canActivate : null}
      />

      <Tabs
        urlKey="tab"
        tabs={[
          {
            label: `Timetable${batch.sessions.length ? ` (${batch.sessions.length})` : ""}`,
            content: <TimetablePanel batch={batch} templates={templates} />,
          },
          {
            /**
             * MATERIAL, as a tab of its own rather than buried in each timetable row.
             *
             * Two different questions live here and the shelf answers the first: "where is
             * everything for this cohort". The per-class material is listed under its class
             * below, which is the second question - "what do I need for Saturday".
             */
            label: `Resources${sessionResourceCount ? ` (${sessionResourceCount})` : ""}`,
            content: (
              <div className="space-y-6">
                <ResourceManager
                  scope="batch"
                  scopeId={batch.id}
                  resources={resources.batch}
                  canManage={batch.canManage}
                  title="For the whole cohort"
                  hint="The WhatsApp group, the shared drive, anything that is true for every class in this batch."
                />
                <div className="space-y-5 border-t border-line pt-5">
                  <h4 className="text-label font-semibold uppercase text-ink-2">Per class</h4>
                  {batch.sessions.length === 0 && (
                    <p className="text-caption text-muted">Build the timetable first - material hangs off a class.</p>
                  )}
                  {batch.sessions.map((s) => (
                    <div key={s.id} className="rounded-card border border-line bg-surface p-3">
                      <p className="mb-1 text-sm font-semibold text-ink">
                        {s.weekNumber !== null ? `Week ${String(s.weekNumber).padStart(2, "0")} · ` : ""}
                        {s.title}
                      </p>
                      <ResourceManager
                        scope="session"
                        scopeId={s.id}
                        resources={resources.bySession.get(s.id) ?? []}
                        inherited={resources.inheritedBySession.get(s.id) ?? []}
                        canManage={batch.canManage}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
          {
            label: `Roster${batch.filled ? ` (${batch.filled})` : ""}`,
            content: (
              <div className="space-y-4">
                {/*
                  THE FIX FOR THE DEAD END.

                  This tab was read-only, and its empty state read "Seat students into this
                  cohort from the Students board" - un-clickable, and wrong: the Students BOARD
                  has no seating control. It was on each student's own record, one enrolment at a
                  time, so filling a twelve-seat cohort meant twelve separate page loads.

                  The control is now here, where the job is, and takes as many people at once as
                  you like. It is drawn only for somebody the seating action will actually accept.
                */}
                {canSeat && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-caption text-muted">
                      {batch.capacityLabel} seats taken
                    </p>
                    <SeatPicker
                      batchId={batch.id}
                      batchName={batch.name}
                      candidates={candidates}
                      filled={batch.filled}
                      targetStrength={batch.targetStrength}
                      mechanismLabel="learners"
                    />
                  </div>
                )}
                {batch.roster.length === 0 ? (
                  <EmptyState
                    title="Nobody seated yet"
                    body={
                      canSeat
                        ? "Add learners above. Only people who have enrolled on a matching programme and are not already in a cohort can be seated."
                        : "Nobody has been seated into this cohort yet."
                    }
                  />
                ) : (
                <TableShell
                  head={
                    <>
                      <Th>Student</Th>
                      <Th>Programme</Th>
                      <Th>Coach</Th>
                      <Th>Attendance</Th>
                      <Th>Status</Th>
                    </>
                  }
                  minWidth={680}
                >
                  <>
                    {batch.roster.map((r) => {
                      const a = rateByStudent.get(r.studentId);
                      return (
                        <Tr key={r.studentId}>
                          <Td>
                            <StudentName name={r.name} code={r.code} />
                          </Td>
                          <Td>{r.programLevel ?? "-"}</Td>
                          <Td>{r.coachName ?? "-"}</Td>
                          <Td>
                            {a && a.ratePct !== null ? (
                              <span className={a.signal === "RED" ? "text-risk" : a.signal === "AMBER" ? "text-warn" : "text-ink-2"}>
                                {formatPct(a.ratePct / 100)}
                                <span className="block text-caption text-muted">
                                  {a.attended}/{a.counted} classes
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted">No register yet</span>
                            )}
                          </Td>
                          <Td>{r.status ?? "-"}</Td>
                        </Tr>
                      );
                    })}
                  </>
                </TableShell>
                )}
              </div>
            ),
          },
        ]}
      />

      {/*
        The footer used to say seating happened somewhere else, which was both the wrong place
        and no longer true. A student's own record keeps its picker - it is the right control
        when you are looking at one person - so this names the pair rather than redirecting.
      */}
      <p className="flex items-center gap-1.5 text-caption text-muted">
        <Users size={12} aria-hidden />
        Learners are seated from the Roster tab here, or one at a time from a student&apos;s own record.
      </p>
    </div>
  );
}
