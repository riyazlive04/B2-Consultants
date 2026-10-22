import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";
import { PageHeader, Pill, TableShell, Td, Th, Tr, EmptyState } from "@/components/ui/kit";
import { requireSession } from "@/lib/rbac";
import { resolveBackLink } from "@/lib/back-link";
import { getBatchDetail } from "@/server/batch-detail";
import { getBatchAttendance } from "@/server/attendance";
import { listCurriculumTemplates } from "@/server/curriculum";
import { batchResources } from "@/server/resources";
import { ResourceManager } from "@/components/resources/ResourceManager";
import { TimetablePanel } from "@/components/batches/TimetablePanel";
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

  const [attendance, templates, resources] = await Promise.all([
    getBatchAttendance(batch.id),
    // Only a manager is offered the build dialog, so only they need the catalogue loaded.
    batch.canManage ? listCurriculumTemplates({ line: "B2", activeOnly: true }) : Promise.resolve([]),
    batchResources(batch.id),
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
            content:
              batch.roster.length === 0 ? (
                <EmptyState
                  title="Nobody seated yet"
                  body="Seat students into this cohort from the Students board."
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
              ),
          },
        ]}
      />

      <p className="flex items-center gap-1.5 text-caption text-muted">
        <Users size={12} aria-hidden />
        Seating is done from the Students board; this screen runs the cohort.
      </p>
    </div>
  );
}
