import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { type CapabilityOverrides } from "@/lib/capabilities";
import { canManageDelivery } from "./batch-access";
import type { AppRole } from "@/lib/sections";
import { toDateInputValue } from "@/lib/dates";
import { capacityBand, capacityLabel } from "@/lib/batch";
import type { SessionDeliveryValue } from "@/lib/curriculum";

/**
 * ONE COHORT, as the people who run it need to see it.
 *
 * German Note already had a batch screen (`/german-note/[batchId]`: classroom, schedule,
 * discussion). This is the other half - the B2 coaching cohort, whose shape is a TIMETABLE:
 * eight named sessions across four weeks, then a sprint. The two are deliberately separate
 * routes rather than one screen with a `line` switch, because almost nothing on them is the
 * same: German Note has 40 ad-hoc classes and a Skool-style feed, a coaching batch has a fixed
 * curriculum and a sprint.
 *
 * VISIBILITY, not a section. A coach and a tutor have no `students` section and no
 * `german-note` section respectively, so gating this route on either would lock out exactly the
 * people who teach from it. `canViewBatch` asks the only question that matters: is this your
 * cohort.
 */

export type TimetableSessionView = {
  id: string;
  weekNumber: number | null;
  orderIndex: number;
  title: string;
  framework: string | null;
  type: string;
  delivery: SessionDeliveryValue;
  /** IST calendar day, YYYY-MM-DD - what the date input and the sheet both want. */
  dateYmd: string;
  /** "HH:MM" IST, or null for a pre-recorded module / a class whose time is not set. */
  timeHm: string | null;
  startsAt: string;
  durationMins: number | null;
  joinUrl: string | null;
  notes: string | null;
  isPast: boolean;
  /** Generated from a curriculum row, as opposed to added by hand on this batch. */
  fromCurriculum: boolean;
  recordingId: string | null;
  recordingUrl: string | null;
  taskCount: number;
  /** How many students have been marked. 0 = the register has never been opened. */
  markedCount: number;
};

export type BatchDetailView = {
  id: string;
  line: "B2" | "GERMAN_NOTE";
  code: string | null;
  name: string;
  level: string;
  status: "ACTIVE" | "ARCHIVED";
  leadId: string | null;
  leadName: string | null;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  sprintStartDate: string | null;
  curriculumTemplateId: string | null;
  curriculumName: string | null;
  sprintDays: number | null;
  targetStrength: number;
  filled: number;
  capacity: ReturnType<typeof capacityBand>;
  capacityLabel: string;
  sessions: TimetableSessionView[];
  roster: {
    studentId: string;
    enrollmentId: string | null;
    name: string;
    code: string | null;
    programLevel: string | null;
    status: string | null;
    coachName: string | null;
  }[];
  /** What the viewer may do here - computed once, server-side, and obeyed by every action. */
  canManage: boolean;
};

/** IST wall-clock parts of an instant, as the sheet shows them. */
function istParts(d: Date): { dateYmd: string; timeHm: string } {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return { dateYmd: ist.toISOString().slice(0, 10), timeHm: ist.toISOString().slice(11, 16) };
}

/**
 * May this person open this batch at all - and may they RUN it?
 *
 * ADMIN and HEAD supervise everything. Anyone holding `batches.manage` is already trusted to
 * move people between cohorts, so they can see one. Otherwise it has to be YOUR cohort: you
 * lead it, or you coach somebody seated in it.
 *
 * ── WHY `manage` IS NOW `canManageDelivery` ─────────────────────────────────────────────
 * It used to return `manage: false` for a Head coach, deliberately - the comment in
 * batch-access.ts recorded that choice. It was wrong in practice, and only ever in one
 * direction: EVERY action this flag draws a button for (build the timetable, add, re-time or
 * remove a class, take the register, post a recording, set the sprint start, hang material off
 * the cohort) is enforced server-side by `canManageDelivery`, which has always said yes to a
 * head coach. So the page hid buttons for work the server was waiting to accept, and the
 * founders' answer when they hit it was the plain one: the head coach runs these classes too.
 *
 * It buys nothing else. Seating students and creating or archiving cohorts are not on this
 * page and keep their own `batches.manage` / Admin fences.
 */
export async function canViewBatch(
  session: { role: AppRole; user: { id: string }; capabilities: CapabilityOverrides | null },
  batchId: string,
): Promise<{ view: boolean; manage: boolean }> {
  // Existence first, and for everyone: `canManageDelivery` answers about STANDING, so an
  // Admin "may manage" an id that was never a batch. The page needs those to be different
  // answers - one redirects, the other would render a cohort made of nulls.
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { tutorId: true } });
  if (!batch) return { view: false, manage: false };

  if (batch.tutorId === session.user.id) return { view: true, manage: true };
  if (await canManageDelivery(session, batchId)) return { view: true, manage: true };

  // A coach whose own student sits in this cohort may read it, but not re-time it.
  const coaches = await prisma.enrollment.count({ where: { batchId, coachId: session.user.id } });
  return { view: coaches > 0, manage: false };
}

export const getBatchDetail = cache(
  async (
    batchId: string,
    session: { role: AppRole; user: { id: string }; capabilities: CapabilityOverrides | null },
  ): Promise<BatchDetailView | null> => {
    const access = await canViewBatch(session, batchId);
    if (!access.view) return null;

    const b = await prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        id: true, line: true, code: true, name: true, level: true, status: true,
        tutorId: true, notes: true, startDate: true, endDate: true, sprintStartDate: true,
        curriculumTemplateId: true, targetStrength: true,
        tutor: { select: { name: true } },
        curriculumTemplate: { select: { name: true, sprintDays: true } },
        events: {
          /**
           * SHEET ORDER - week first, then the clock.
           *
           * Not `startsAt` alone, which is what this used to be. A pre-recorded module is stored
           * at midnight of its release day, so it sorts ahead of a live class held the same day:
           * "Week 04 German Interview Structure" landed above "Week 03 Open Job Market" and the
           * week column read 01, 02, 02, 03, 03, 04, 03, 04. The timetable panel re-sorted for
           * itself and looked right; the Resources tab consumed this list directly and did not,
           * so one page showed a cohort's classes in two different orders.
           *
           * Postgres puts NULLs last on ASC, so an ad-hoc class with no week falls to the end -
           * which is exactly where it belongs.
           */
          orderBy: [{ weekNumber: "asc" }, { startsAt: "asc" }, { orderIndex: "asc" }],
          select: {
            id: true, weekNumber: true, orderIndex: true, title: true, framework: true,
            type: true, delivery: true, startsAt: true, durationMins: true, joinUrl: true,
            notes: true, curriculumItemId: true, recordingId: true,
            recording: { select: { videoUrl: true } },
            _count: { select: { tasks: true, attendance: true } },
          },
        },
        members: {
          select: { student: { select: { id: true, fullName: true, code: true } } },
          orderBy: { addedAt: "asc" },
        },
        enrollments: {
          select: {
            id: true, programLevel: true, status: true,
            student: { select: { id: true, fullName: true, code: true } },
            coach: { select: { name: true } },
            assignedCoach: true,
          },
          orderBy: { enrollmentDate: "asc" },
        },
      },
    });
    if (!b) return null;

    const now = Date.now();
    const sessions: TimetableSessionView[] = b.events.map((e) => {
      const { dateYmd, timeHm } = istParts(e.startsAt);
      const pre = e.delivery === "PRE_RECORDED";
      return {
        id: e.id,
        weekNumber: e.weekNumber,
        orderIndex: e.orderIndex,
        title: e.title,
        framework: e.framework,
        type: e.type,
        delivery: pre ? "PRE_RECORDED" : "LIVE",
        dateYmd,
        // IST midnight is how both "no clock" cases are stored, so it reads back as "no time"
        // rather than as a class at 00:00.
        timeHm: pre || timeHm === "00:00" ? null : timeHm,
        startsAt: e.startsAt.toISOString(),
        durationMins: e.durationMins,
        joinUrl: e.joinUrl,
        notes: e.notes,
        isPast: e.startsAt.getTime() < now,
        fromCurriculum: e.curriculumItemId !== null,
        recordingId: e.recordingId,
        recordingUrl: e.recording?.videoUrl ?? null,
        taskCount: e._count.tasks,
        markedCount: e._count.attendance,
      };
    });

    const roster = [
      ...b.members.map((m) => ({
        studentId: m.student.id,
        enrollmentId: null,
        name: m.student.fullName,
        code: m.student.code,
        programLevel: null,
        status: null,
        coachName: null,
      })),
      ...b.enrollments.map((e) => ({
        studentId: e.student.id,
        enrollmentId: e.id,
        name: e.student.fullName,
        code: e.student.code,
        programLevel: e.programLevel,
        status: e.status as string,
        coachName: e.coach?.name ?? e.assignedCoach ?? null,
      })),
    ];
    const filled = roster.length;

    return {
      id: b.id,
      line: b.line,
      code: b.code,
      name: b.name,
      level: b.level,
      status: b.status,
      leadId: b.tutorId,
      leadName: b.tutor?.name ?? null,
      notes: b.notes,
      startDate: b.startDate ? toDateInputValue(b.startDate) : null,
      endDate: b.endDate ? toDateInputValue(b.endDate) : null,
      sprintStartDate: b.sprintStartDate ? toDateInputValue(b.sprintStartDate) : null,
      curriculumTemplateId: b.curriculumTemplateId,
      curriculumName: b.curriculumTemplate?.name ?? null,
      sprintDays: b.curriculumTemplate?.sprintDays ?? null,
      targetStrength: b.targetStrength,
      filled,
      capacity: capacityBand(filled, b.targetStrength),
      capacityLabel: capacityLabel(filled, b.targetStrength),
      sessions,
      roster,
      canManage: access.manage && b.status === "ACTIVE",
    };
  },
);
