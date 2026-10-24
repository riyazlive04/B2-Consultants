"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { BatchLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SEATED_STATUSES } from "@/lib/enrollment-lifecycle";
import { requireAdmin, requireCapability } from "@/lib/rbac";
import {
  levelFitsBatchLine,
  normalizeBatchCode,
  capacityBand,
  canActivateBatch,
  describeBlockers,
  type BatchReadinessInput,
} from "@/lib/batch";
import { istToday, toDateInputValue } from "@/lib/dates";
import { getLevels } from "./levels";
import { logActivity, diffFields } from "./activity-log";
import { seatStudentTasks } from "./session-tasks";
import { sendStudentWelcome } from "./whatsapp";
import { afterResponse } from "./after-response";
import type { ActionResult } from "./finance-actions";

/**
 * Batch writes (ER v2 Track A).
 *
 * CREATING and ARCHIVING a batch is `requireAdmin()`. SEATING is `batches.manage`, because
 * deciding which cohort a student joins is a delivery call the Head coach plausibly makes -
 * without thereby handing them every other write on the Students board.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** The level's kind, or null if it isn't in the active catalogue. */
async function levelKindOf(code: string) {
  return (await getLevels()).find((l) => l.code === code && l.active)?.kind ?? null;
}

const batchSchema = z.object({
  line: z.enum(["B2", "GERMAN_NOTE"]),
  name: z.string().trim().min(1, "Batch name is required").max(160),
  code: z.string().trim().max(24).optional(),
  level: z.string().trim().min(1, "Pick a level"),
  tutorId: z.string().trim().optional(),
  targetStrength: z.coerce.number().int().min(0).max(500).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Edit only - the create form does not offer it, and an absent status means ACTIVE. */
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

/**
 * The person running the cohort. `Batch.tutorId` is a plain User reference, so this is the guard
 * that keeps a student account - or a suspended one - out of it. Returns `undefined` for invalid,
 * which the callers treat as a refusal rather than as "no lead".
 */
async function validLeadId(userId: string | undefined): Promise<string | null | undefined> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
  if (!user || user.role === "STUDENT" || user.status !== "ACTIVE") return undefined;
  return userId;
}

const asDate = (v: string | undefined) => (v && v.trim() ? new Date(v) : null);

export async function upsertBatch(batchId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = batchSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const kind = await levelKindOf(d.level);
  if (!kind) return { ok: false, error: "Pick a level from the active catalogue" };
  // The guard the one-table design has to carry: without it, unifying gn_batch into batch
  // would silently allow a coaching client to be seated in an A1 German cohort.
  if (!levelFitsBatchLine(kind, d.line as BatchLine)) {
    return { ok: false, error: `A ${kind.replace("_", " ").toLowerCase()} does not belong to a ${d.line === "B2" ? "B2 Coaching" : "German Note"} batch` };
  }

  const tutorId = await validLeadId(d.tutorId);
  if (tutorId === undefined) return { ok: false, error: "That account can't lead a batch - pick an active team member" };

  // An end date before the start would make `batchDayNumber` and every cohort report nonsense.
  if (d.startDate && d.endDate && d.endDate < d.startDate) {
    return { ok: false, error: "The end date is before the start date" };
  }

  const code = d.code ? normalizeBatchCode(d.code) : "";
  if (d.code && !code) return { ok: false, error: "That batch code has no usable characters" };
  if (code) {
    const clash = await prisma.batch.findFirst({ where: { code, NOT: batchId ? { id: batchId } : undefined }, select: { name: true } });
    if (clash) return { ok: false, error: `Batch code "${code}" is already used by ${clash.name}` };
  }

  const data = {
    line: d.line as BatchLine,
    name: d.name,
    code: code || null,
    level: d.level,
    tutorId,
    targetStrength: d.targetStrength ?? 8,
    startDate: asDate(d.startDate),
    endDate: asDate(d.endDate),
    notes: d.notes || null,
    // Absent on the create form; on edit it is how a finished cohort is closed.
    ...(d.status ? { status: d.status } : {}),
  };

  const before = batchId ? await prisma.batch.findUnique({ where: { id: batchId } }) : null;
  const batch = batchId
    ? await prisma.batch.update({ where: { id: batchId }, data })
    : await prisma.batch.create({ data });

  await logActivity(session, {
    action: batchId ? "batch.update" : "batch.create",
    section: d.line === "B2" ? "students" : "german-note",
    entityType: "Batch",
    entityId: batch.id,
    summary: `${batchId ? "Updated" : "Created"} the ${d.line === "B2" ? "coaching" : "German Note"} batch "${batch.name}"`,
    meta: before ? { changed: diffFields(before, batch) } : {},
  });

  revalidatePath("/students");
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  return { ok: true };
}

/**
 * Delete a batch - only one nobody has been put in yet.
 *
 * Archive is the normal way to close a cohort (`upsertBatch` with status ARCHIVED): it keeps the
 * roster, the sessions and the history readable. This exists for the other case - a batch created
 * by mistake, or with a typo in its code - and it REFUSES the moment anything hangs off the row.
 * `Enrollment.batchId` is `onDelete: SetNull`, so a careless delete would not error; it would
 * quietly unseat everyone in the cohort and leave no trace of where they had been.
 */
export async function deleteBatch(batchId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: {
      name: true,
      line: true,
      level: true,
      /**
       * DELIBERATELY UNFILTERED, unlike the seat counts elsewhere.
       *
       * This guard asks "has anyone ever been in this cohort", not "is anyone in it now". A
       * batch whose students all dropped still holds their history: `Enrollment.batchId` is
       * `onDelete: SetNull`, so deleting it would not error - it would quietly unseat them and
       * erase where they had been. Filtering to seated enrolments here would make exactly the
       * cohorts most worth keeping the easiest to delete.
       */
      _count: { select: { members: true, enrollments: true, events: true, recordings: true } },
    },
  });
  if (!batch) return { ok: false, error: "Batch not found" };
  const { members, enrollments, events, recordings } = batch._count;
  const seated = members + enrollments;
  if (seated > 0) {
    return { ok: false, error: `${batch.name} has ${seated} ${seated === 1 ? "person" : "people"} in it - archive it instead of deleting.` };
  }
  if (events + recordings > 0) {
    return { ok: false, error: `${batch.name} has classes or recordings against it - archive it instead of deleting.` };
  }

  await prisma.batch.delete({ where: { id: batchId } });
  await logActivity(session, {
    action: "batch.delete",
    section: batch.line === "B2" ? "students" : "german-note",
    entityType: "Batch",
    entityId: batchId,
    summary: `Deleted the empty ${batch.line === "B2" ? "coaching" : "German Note"} batch "${batch.name}"`,
    meta: { line: batch.line, level: batch.level },
  });
  revalidatePath("/students");
  revalidatePath("/german-note");
  revalidatePath("/german-note/manage");
  return { ok: true };
}

/**
 * Seat an enrollment in a batch.
 *
 * Over-capacity is a WARNING, not a refusal (`confirmed` re-submits past it). The founders
 * overfill on purpose when a ninth person turns up and the next cohort is a month away - a
 * hard block would send them back to a spreadsheet, which is the failure this whole track
 * exists to end.
 */
export async function seatEnrollment(
  enrollmentId: string,
  batchId: string,
  confirmed = false,
): Promise<ActionResult> {
  const session = await requireCapability("batches.manage");

  const [enrollment, batch] = await Promise.all([
    prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true, programLevel: true, batchId: true, studentId: true, student: { select: { fullName: true } } },
    }),
    prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        name: true,
        line: true,
        status: true,
        targetStrength: true,
        /**
         * SEATED enrolments only - and this is the count that actually ENFORCES capacity.
         *
         * The batch screens' `filled` was fixed to exclude a student who has left, but this
         * gate was not, which was worse than leaving both wrong: the cohort card read 8/10
         * while seating still refused at 10, so the display and the rule disagreed about the
         * same cohort. A student who dropped has given their seat back, and the replacement
         * the founders already sold to has to be able to take it.
         */
        _count: { select: { members: true, enrollments: { where: { status: { in: [...SEATED_STATUSES] } } } } },
      },
    }),
  ]);
  if (!enrollment) return { ok: false, error: "Enrollment not found" };
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "ACTIVE") return { ok: false, error: "That batch is archived" };

  const kind = await levelKindOf(enrollment.programLevel);
  if (kind && !levelFitsBatchLine(kind, batch.line)) {
    return { ok: false, error: `${enrollment.programLevel} does not belong to a ${batch.line === "B2" ? "B2 Coaching" : "German Note"} batch` };
  }

  const filled = batch._count.members + batch._count.enrollments;
  if (!confirmed && capacityBand(filled, batch.targetStrength) === "over") {
    return { ok: false, error: `OVER_CAPACITY:${filled}:${batch.targetStrength}` };
  }

  await prisma.enrollment.update({ where: { id: enrollmentId }, data: { batchId } });

  // Backfill the coursework this batch has already set. Without it someone who joins in week
  // three sees an empty task list and reads as fully up to date - the opposite of the truth.
  const backfilled = await seatStudentTasks(batchId, enrollment.studentId);

  await logActivity(session, {
    action: "batch.seat",
    section: "students",
    entityType: "Enrollment",
    entityId: enrollmentId,
    summary: `Seated ${enrollment.student.fullName} in ${batch.name}`,
    meta: { batchId, fromBatchId: enrollment.batchId, tasksBackfilled: backfilled },
  });

  /**
   * The enrolment welcome - the first (and until now, only) thing the app would say to someone
   * who has just become a student.
   *
   * Seating is the right trigger because it is the moment the message HAS something to say:
   * this is the step that decides their batch, and therefore their tutor and their first class.
   * Firing on enrolment instead would send "your tutor is …" before anyone had picked one.
   *
   * Deferred, and never allowed to fail the seat: `sendStudentWelcome` resolves an outcome
   * rather than throwing, it is a once-ever send guarded inside, and it is a no-op until the
   * founder arms `studentWelcomeEnabled`. A student who was seated before it was armed still
   * gets their welcome the first time anyone re-seats them, which is the recoverable direction.
   */
  afterResponse(`student-welcome:${enrollment.studentId}`, async () => {
    await sendStudentWelcome(enrollment.studentId, session.user.id);
  });

  revalidatePath("/students");
  revalidatePath("/german-note");
  return { ok: true };
}

export async function unseatEnrollment(enrollmentId: string): Promise<ActionResult> {
  const session = await requireCapability("batches.manage");
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { batchId: true, student: { select: { fullName: true } }, batch: { select: { name: true } } },
  });
  if (!enrollment) return { ok: false, error: "Enrollment not found" };
  if (!enrollment.batchId) return { ok: false, error: "That enrollment is not seated in a batch" };

  await prisma.enrollment.update({ where: { id: enrollmentId }, data: { batchId: null } });
  await logActivity(session, {
    action: "batch.unseat",
    section: "students",
    entityType: "Enrollment",
    entityId: enrollmentId,
    summary: `Removed ${enrollment.student.fullName} from ${enrollment.batch?.name ?? "their batch"}`,
    meta: { fromBatchId: enrollment.batchId },
  });

  revalidatePath("/students");
  revalidatePath("/german-note");
  return { ok: true };
}

/**
 * START A COHORT — the Activate gate (refactor step C3).
 *
 * ── Why this action exists at all, when readiness is derived ────────────────────────────
 * `batchReadiness` works out DRAFT / READY / ACTIVE / COMPLETED from the row every render, so
 * there is no status column to flip and nothing here "sets" a cohort active. What the founders
 * were missing was the opposite: a cohort was ACTIVE from the moment it was saved, so there was
 * no moment of starting it and no check that it could teach anybody. This supplies that moment.
 *
 * The one fact it writes is `startDate`, because that is what `batchTiming` reads to say a
 * cohort is RUNNING. Activating is therefore "it starts today", which is the truth the founders
 * mean when they press it.
 *
 * ── What it refuses, and why those two cases differ ─────────────────────────────────────
 *  · Missing a plan, a teacher or a learner → refused, naming them. These are
 *    `activationBlockers`, deliberately three of the checklist's five: a cohort can legitimately
 *    begin before its later weeks are timed, and a gate demanding all five is a gate the
 *    founders route around (see `activationBlockers` in lib/batch.ts).
 *  · Already dated in the FUTURE, with classes on the calendar → refused, and it sends them to
 *    the batch form instead. Those sessions were sequenced from the existing start date, so
 *    silently pulling the start to today would leave week one teaching before the cohort began.
 *    With no sessions yet there is nothing to desync, so that case is allowed.
 *
 * Idempotent: a cohort that has already started returns ok and writes nothing.
 */
export async function activateBatch(batchId: string): Promise<ActionResult> {
  const session = await requireAdmin();

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      name: true,
      line: true,
      status: true,
      curriculumTemplateId: true,
      tutorId: true,
      startDate: true,
      endDate: true,
      targetStrength: true,
      // The same two counts `seatCount` unifies - members plus SEATED enrolments. Counting only
      // one of them is the disagreement this refactor exists to end.
      _count: {
        select: {
          members: true,
          enrollments: { where: { status: { in: [...SEATED_STATUSES] } } },
          events: true,
        },
      },
    },
  });
  if (!batch) return { ok: false, error: "Batch not found" };
  if (batch.status !== "ACTIVE") return { ok: false, error: "That batch is archived" };

  const today = istToday();
  const readiness: BatchReadinessInput = {
    status: batch.status,
    line: batch.line,
    curriculumTemplateId: batch.curriculumTemplateId,
    tutorId: batch.tutorId,
    startDate: batch.startDate,
    endDate: batch.endDate,
    seats: { members: batch._count.members, seatedEnrollments: batch._count.enrollments },
    sessionCount: batch._count.events,
    // Only used for the COMPLETED reading, which cannot apply to a cohort being started.
    upcomingSessionCount: batch._count.events,
  };

  const gate = canActivateBatch(readiness);
  if (!gate.ok) {
    return { ok: false, error: `${describeBlockers(gate.blockers)} before this cohort can start.` };
  }

  if (batch.startDate && batch.startDate <= today) return { ok: true };
  if (batch.startDate && batch._count.events > 0) {
    return {
      ok: false,
      error: `${batch.name} is already scheduled to start on ${toDateInputValue(batch.startDate)} and its classes are timed from that date. Change the start date on the batch form if it should begin sooner.`,
    };
  }

  await prisma.batch.update({ where: { id: batchId }, data: { startDate: today } });

  await logActivity(session, {
    action: "batch.activate",
    section: batch.line === "B2" ? "students" : "german-note",
    entityType: "Batch",
    entityId: batchId,
    summary: `Started the ${batch.line === "B2" ? "coaching" : "German Note"} batch "${batch.name}"`,
    meta: { startDate: toDateInputValue(today), previousStartDate: batch.startDate ? toDateInputValue(batch.startDate) : null },
  });

  revalidatePath("/batches");
  revalidatePath(`/batches/${batchId}`);
  revalidatePath("/students");
  revalidatePath("/german-note");
  return { ok: true };
}
