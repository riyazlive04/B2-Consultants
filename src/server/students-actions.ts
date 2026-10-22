"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSession, type AppSession } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { intInRange, optionalRule, rule } from "@/lib/field-rules";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";
import { sendLoginCredentials } from "./login-credentials";
import { allocateStudentCode, lineForLevel } from "./student-code";
import { getDeliveryDefaults, getStudentLifecycleConfig } from "./founder-config";
import {
  decideDiscontinue,
  DISCONTINUED_STATUS,
  OTHER_REASON,
} from "@/lib/enrollment-lifecycle";
import { normalizeStudentCode } from "@/lib/student-code";
import { Prisma } from "@prisma/client";

/**
 * Students (PRD2 §4). Profiles/enrollments/satisfaction/deletes = Admin.
 * Tracker fields + milestone + signal colour = Admin OR Head (Karthick updates
 * after sessions; PRD2 §4.3/§6). Milestone + signal changes append immutable logs.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

async function requireAdminOrHead() {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "HEAD") {
    throw new Error("Not allowed");
  }
  return session;
}

const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// ── Student profile + enrollment ───────────────────────────────

const B2_LEVELS = ["SOLO", "GUIDED", "ELITE"] as const; // German Note excluded (PRD2 §4)

/** A duplicate `code` is the one failure these actions can cause, and it must read as English. */
const DUPLICATE_CODE = "That student ID is already taken - every student needs their own.";
const isDuplicateCode = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const studentSchema = z.object({
  fullName: rule("name"),
  /**
   * The human-readable student number, now editable rather than generated-and-frozen.
   *
   * Optional at every call site: left blank on CREATE it is allocated as before, and left blank
   * on UPDATE the existing code is kept rather than cleared. That asymmetry is deliberate - the
   * code is printed on agreements and quoted on calls, so "I did not type anything" must never
   * be read as "remove their identifier".
   *
   * Format is checked but not imposed. `parseStudentCode` already tolerates anything outside
   * `B2-d+` (it returns null, and the generator skips it), so a code carried over from another
   * system is allowed to stay in its own shape. What is refused is only what would break a URL,
   * a CSV cell or a search box.
   */
  code: z
    .string()
    .trim()
    .max(24, "A student ID can be at most 24 characters")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, numbers, dashes, dots or slashes")
    .optional()
    .or(z.literal("")),
  email: optionalRule("email"),
  phone: optionalRule("phone"),
  // Free text: "3D Printing" / "SAP S/4HANA Consultant" are real answers here.
  industry: z.string().trim().optional(),
  targetRole: z.string().trim().optional(),
  leadSource: z
    .enum(["INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP", "GHOSTED_BLUEPRINT", "OTHER"])
    .optional()
    .or(z.literal("")),
  internalNotes: optionalRule("text"),
});

const enrollmentSchema = z.object({
  programLevel: z.enum(B2_LEVELS),
  enrollmentDate: z.string().min(10),
  totalSessionsPlanned: z.string().trim().regex(/^\d{0,4}$/).optional(),
  assignedCoach: z.string().trim().optional(),
  closerId: z.string().trim().optional(), // L3 closer (User id) for the commission split
});

/** Duration + end date derive from level (PRD2 §4.1): Guided 90d, Elite 120d, Solo lifetime. */
function derivedDuration(level: (typeof B2_LEVELS)[number], start: Date) {
  if (level === "SOLO") return { duration: "LIFETIME" as const, programEndDate: null };
  const days = level === "GUIDED" ? 90 : 120;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);
  return { duration: level === "GUIDED" ? ("DAYS_90" as const) : ("DAYS_120" as const), programEndDate: end };
}

/**
 * The coach NAME the form submits, resolved to the account behind it.
 *
 * The picker's values are names, not ids, and that is kept on purpose: `assignedCoach` carries
 * years of rows naming coaches who never had a login, and an outside coach may still have none.
 * So the name stays the record and `coachId` is derived from it - which is what puts a student
 * on their coach's desk (`Enrollment.coachId`) without asking anyone to re-pick a coach they
 * have already chosen.
 *
 * Returns null for a blank, an unknown name, or a name that is not unique among active accounts
 * - all three mean "we cannot say which account this is", and a wrong link is worse than none.
 */
async function resolveCoachId(name: string | null | undefined): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const matches = await prisma.user.findMany({
    where: { name: trimmed, status: "ACTIVE", role: { not: "STUDENT" } },
    select: { id: true },
    take: 2,
  });
  return matches.length === 1 ? matches[0].id : null;
}

export async function createStudent(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const s = studentSchema.safeParse(Object.fromEntries(form));
  const e = enrollmentSchema.safeParse(Object.fromEntries(form));
  if (!s.success) return { ok: false, error: firstError(s.error) };
  if (!e.success) return { ok: false, error: firstError(e.error) };

  const start = parseDateInput(e.data.enrollmentDate);
  const { duration, programEndDate } = derivedDuration(e.data.programLevel, start);

  // The founder's default coach (Console → Delivery & team → Delivery defaults). Blank is a
  // legitimate answer and leaves the field empty, which is honest when nobody is assigned yet.
  const { defaultCoach } = await getDeliveryDefaults();
  const coachName = e.data.assignedCoach || defaultCoach;
  const coachId = await resolveCoachId(coachName);

  // Typed in wins; blank falls back to the next generated number, exactly as before - in the
  // series the programme level belongs to (B2-0001… or GN-0001…), derived not asked for.
  const typedCode = normalizeStudentCode(s.data.code);
  let student;
  try {
    student = await prisma.student.create({
      data: {
        code: typedCode ?? (await allocateStudentCode(prisma, await lineForLevel(e.data.programLevel))),
        fullName: s.data.fullName,
        email: s.data.email || null,
        phone: s.data.phone || null,
        industry: s.data.industry || null,
        targetRole: s.data.targetRole || null,
        leadSource: s.data.leadSource || null,
        internalNotes: s.data.internalNotes || null,
        enrollments: {
          create: {
            programLevel: e.data.programLevel,
            enrollmentDate: start,
            duration,
            programEndDate,
            totalSessionsPlanned: e.data.totalSessionsPlanned?.trim()
              ? parseInt(e.data.totalSessionsPlanned, 10)
              : null,
            assignedCoach: coachName,
            coachId,
            closerId: e.data.closerId || null,
            milestoneLogs: { create: { newMilestone: "ONBOARDING" } },
          },
        },
      },
    });
  } catch (e) {
    // `code` is @unique - a typed-in duplicate is refused by the database, not by a read.
    if (isDuplicateCode(e)) return { ok: false, error: DUPLICATE_CODE };
    throw e;
  }

  // Auto-link past income entries by matching name (fee pulled from Finance, PRD2 §4.1)
  const candidates = await prisma.income.findMany({ where: { studentId: null } });
  const ids = candidates.filter((i) => nameKey(i.studentName) === nameKey(student.fullName)).map((i) => i.id);
  if (ids.length) {
    await prisma.income.updateMany({ where: { id: { in: ids } }, data: { studentId: student.id } });
  }
  await logActivity(session, {
    action: "student.create",
    section: "students",
    entityType: "Student",
    entityId: student.id,
    summary: `Enrolled ${student.fullName} - ${e.data.programLevel}`,
    meta: {
      programLevel: e.data.programLevel,
      enrollmentDate: e.data.enrollmentDate,
      assignedCoach: coachName,
      incomeEntriesLinked: ids.length,
    },
  });
  revalidatePath("/students");
  revalidatePath("/finance");
  return { ok: true };
}

/**
 * Convert a qualified lead into a Student without re-keying anything (issue 2.1). Carries the
 * lead's name/email/phone/industry/source forward and stamps Student.leadId so the two records
 * stay joined. No enrollment is created - the program level isn't known at convert time; the
 * founder adds it from the new student record (which is visible immediately even without one).
 * Idempotent: a lead already converted returns its existing student instead of a duplicate.
 */
export async function convertLeadToStudent(
  leadId: string,
): Promise<ActionResult & { studentId?: string }> {
  const session = await requireAdmin();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, email: true, phone: true, industry: true, leadSource: true },
  });
  if (!lead) return { ok: false, error: "Lead not found" };

  const existing = await prisma.student.findFirst({ where: { leadId }, select: { id: true } });
  if (existing) return { ok: true, studentId: existing.id };

  const student = await prisma.student.create({
    data: {
      code: await allocateStudentCode(),
      fullName: lead.name,
      email: lead.email || null,
      phone: lead.phone || null,
      industry: lead.industry || null,
      leadSource: lead.leadSource,
      leadId: lead.id,
    },
  });

  // Same name-match backfill createStudent does - a payment recorded before conversion links up.
  const candidates = await prisma.income.findMany({ where: { studentId: null } });
  const ids = candidates.filter((i) => nameKey(i.studentName) === nameKey(student.fullName)).map((i) => i.id);
  if (ids.length) {
    await prisma.income.updateMany({ where: { id: { in: ids } }, data: { studentId: student.id } });
  }

  await logActivity(session, {
    action: "student.convert",
    section: "students",
    entityType: "Student",
    entityId: student.id,
    summary: `Converted lead ${lead.name} into a student`,
    meta: { leadId: lead.id, incomeEntriesLinked: ids.length },
  });
  revalidatePath("/students");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${lead.id}`);
  revalidatePath("/finance");
  return { ok: true, studentId: student.id };
}

export async function updateStudent(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const s = studentSchema.safeParse(Object.fromEntries(form));
  if (!s.success) return { ok: false, error: firstError(s.error) };
  // Blank means "leave it alone", never "clear it" - the code is printed on agreements and
  // quoted on calls, so an empty box must not strip a student of their identifier.
  const nextCode = normalizeStudentCode(s.data.code);
  const data = {
    fullName: s.data.fullName,
    email: s.data.email || null,
    phone: s.data.phone || null,
    industry: s.data.industry || null,
    targetRole: s.data.targetRole || null,
    leadSource: s.data.leadSource || null,
    internalNotes: s.data.internalNotes || null,
    ...(nextCode ? { code: nextCode } : {}),
  };
  const before = await prisma.student.findUnique({ where: { id } });
  try {
    await prisma.student.update({ where: { id }, data });
  } catch (e) {
    // `code` is @unique, so the database is what rejects a collision - there is no read-then-write
    // window here to lose a race in.
    if (isDuplicateCode(e)) return { ok: false, error: DUPLICATE_CODE };
    throw e;
  }
  const diff = before
    ? diffFields<Record<string, unknown>>(before, data)
    : { changed: [], before: {}, after: {} };
  if (diff.changed.length) {
    await logActivity(session, {
      action: "student.update",
      section: "students",
      entityType: "Student",
      entityId: id,
      summary: `Updated ${data.fullName} - changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/students");
  return { ok: true };
}

export async function deleteStudent(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  await prisma.income.updateMany({ where: { studentId: id }, data: { studentId: null } });
  const student = await prisma.student.delete({ where: { id } });
  await logActivity(session, {
    action: "student.delete",
    section: "students",
    entityType: "Student",
    entityId: id,
    summary: `Deleted ${student.fullName}'s student record`,
    meta: { email: student.email, phone: student.phone },
  });
  revalidatePath("/students");
  return { ok: true };
}

/** Upgrade path (Solo → Guided etc.): SAME student, NEW enrollment (CONTEXT §7). */
export async function addEnrollment(studentId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const e = enrollmentSchema.safeParse(Object.fromEntries(form));
  if (!e.success) return { ok: false, error: firstError(e.error) };
  const start = parseDateInput(e.data.enrollmentDate);
  const { duration, programEndDate } = derivedDuration(e.data.programLevel, start);
  // Same founder default as createStudent - see the note there.
  const { defaultCoach } = await getDeliveryDefaults();
  const coachName = e.data.assignedCoach || defaultCoach;
  const coachId = await resolveCoachId(coachName);
  const enrollment = await prisma.enrollment.create({
    data: {
      studentId,
      programLevel: e.data.programLevel,
      enrollmentDate: start,
      duration,
      programEndDate,
      totalSessionsPlanned: e.data.totalSessionsPlanned?.trim()
        ? parseInt(e.data.totalSessionsPlanned, 10)
        : null,
      assignedCoach: coachName,
      coachId,
      closerId: e.data.closerId || null,
      milestoneLogs: { create: { newMilestone: "ONBOARDING" } },
    },
    include: { student: { select: { fullName: true } } },
  });
  await logActivity(session, {
    action: "enrollment.create",
    section: "students",
    entityType: "Enrollment",
    entityId: enrollment.id,
    summary: `Added a ${e.data.programLevel} enrollment for ${enrollment.student.fullName}`,
    meta: {
      programLevel: e.data.programLevel,
      enrollmentDate: e.data.enrollmentDate,
      assignedCoach: coachName,
    },
  });
  revalidatePath("/students");
  return { ok: true };
}

/**
 * Re-assign the coach on an existing enrollment.
 *
 * Coaching assignments change - somebody leaves, a caseload is rebalanced, a student moves to
 * Elite - and until now the only moment a coach could be set was the instant the enrollment was
 * created. That is also what makes `Enrollment.coachId` worth having: the teaching desk is only
 * as good as the assignment behind it.
 *
 * Writes BOTH fields. The name stays the human record (and the only record for a coach with no
 * login); the id is what the desk filters on.
 */
export async function setEnrollmentCoach(enrollmentId: string, coachName: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const name = coachName.trim();
  const coachId = await resolveCoachId(name);

  const enrollment = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { assignedCoach: name || null, coachId },
    select: { id: true, student: { select: { id: true, fullName: true } } },
  });

  await logActivity(session, {
    action: "enrollment.coach.set",
    section: "students",
    entityType: "Enrollment",
    entityId: enrollment.id,
    summary: name
      ? `Assigned ${enrollment.student.fullName} to ${name}`
      : `Cleared ${enrollment.student.fullName}'s coach`,
    meta: { coachId, linked: coachId !== null },
  });

  revalidatePath("/students");
  revalidatePath(`/students/${enrollment.student.id}`);
  revalidatePath("/coaching");
  return { ok: true };
}

/** Set / change the L3 closer (sales-call rep) on an enrollment - the third leg of the
 *  commission split. An empty id clears it. */
export async function setEnrollmentCloser(enrollmentId: string, closerId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, closerId: true, student: { select: { fullName: true } } },
  });
  if (!enrollment) return { ok: false, error: "Enrollment not found" };
  let closerName: string | null = null;
  if (closerId) {
    const user = await prisma.user.findUnique({ where: { id: closerId }, select: { id: true, name: true } });
    if (!user) return { ok: false, error: "Closer not found" };
    closerName = user.name;
  }
  await prisma.enrollment.update({ where: { id: enrollmentId }, data: { closerId: closerId || null } });
  const diff = diffFields<Record<string, unknown>>({ closerId: enrollment.closerId }, { closerId: closerId || null });
  if (diff.changed.length) {
    await logActivity(session, {
      action: "enrollment.assign",
      section: "students",
      entityType: "Enrollment",
      entityId: enrollmentId,
      summary: closerName
        ? `Set ${closerName} as the closer on ${enrollment.student.fullName}'s enrollment`
        : `Cleared the closer on ${enrollment.student.fullName}'s enrollment`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after, closerName },
    });
  }
  revalidatePath("/students");
  return { ok: true };
}

const statusSchema = z.enum(["ACTIVE", "COMPLETED", "DROPPED", "PAUSED"]);

export async function setEnrollmentStatus(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const status = statusSchema.safeParse(form.get("status"));
  if (!status.success) return { ok: false, error: "Invalid status" };
  const existing = await prisma.enrollment.findUnique({
    where: { id },
    include: { student: { select: { fullName: true } } },
  });
  if (!existing) return { ok: false, error: "Enrollment not found" };
  if (existing.status !== status.data) {
    await prisma.enrollment.update({
      where: { id },
      data: { status: status.data, statusChangedAt: new Date() },
    });
    await logActivity(session, {
      action: "enrollment.update",
      section: "students",
      entityType: "Enrollment",
      entityId: id,
      summary: `Marked ${existing.student.fullName}'s ${existing.programLevel} enrollment ${status.data}`,
      meta: { changed: ["status"], before: { status: existing.status }, after: { status: status.data } },
    });
  }
  revalidatePath("/students");
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * DISCONTINUING A STUDENT - the button the founders asked for (@37:54-39:42).
 *
 * `setEnrollmentStatus` above can already move a status to DROPPED, and it stays: it is the
 * Admin's four-way picker on the student record. This pair is the OTHER half, and it differs in
 * three ways that are the entire point of it:
 *
 *   1. a reason is REQUIRED, from the founder-editable vocabulary (@39:42 wants the breakdown);
 *   2. the COACH who owns the enrolment may press it, not only an Admin - they are the person
 *      who knows, and Console can take that away (`coachMayDiscontinue`);
 *   3. it is reversible, and reversing it clears the reason rather than leaving a row that
 *      reads ACTIVE with an explanation of why the student left attached to it.
 *
 * ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────────────────────
 * MONEY. Discontinuing is not a refund: §8 of the agreement is explicit that withdrawal earns
 * no refund, so the instalments the student signed for stay owed, the receivable stays open and
 * the dunning ladder keeps running. That is not a decision taken here - it is true because
 * revenue recognition, instalment settlement and dunning read `pending_payment.status` and
 * `income`, and never enrolment status. `lib/__tests__/enrollment-lifecycle.test.ts` asserts
 * that separation so a later refactor cannot quietly couple them.
 * ──────────────────────────────────────────────────────────────────────────────────────── */

const discontinueSchema = z.object({
  reason: rule("text"),
  note: optionalRule("text"),
});

/**
 * Who may discontinue THIS enrolment.
 *
 * Admin always. Head always - they supervise the coaching floor, and this is the same widening
 * as the attendance-marking rights they already have. The owning coach when the founder has
 * left `coachMayDiscontinue` on.
 *
 * Deliberately NOT "any coach": the desk shows a supervisor every active enrolment, and the
 * right to see a caseload is not the right to end somebody else's student's programme.
 */
async function mayDiscontinue(
  session: AppSession,
  enrollment: { coachId: string | null },
): Promise<boolean> {
  /**
   * A STUDENT is refused BY ROLE, before anything else is considered.
   *
   * The ownership test below would almost certainly refuse them anyway - a student's user id
   * would have to be sitting in `coachId` - but "almost certainly" is the wrong standard for
   * the one action that ends a programme. Leaving it to that coincidence means the guard holds
   * because of a data accident rather than because of a rule, and a staff account later
   * converted to a student login, or a `coachId` filled from the wrong id, would walk through it.
   */
  if (session.role === "STUDENT") return false;
  if (session.role === "ADMIN" || session.role === "HEAD") return true;
  // Not "any coach": a supervisor's desk lists every active enrolment, and seeing a caseload is
  // not the right to end someone else's student's programme.
  if (!enrollment.coachId || enrollment.coachId !== session.user.id) return false;
  const config = await getStudentLifecycleConfig();
  return config.coachMayDiscontinue;
}

export async function discontinueEnrollment(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = discontinueSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const existing = await prisma.enrollment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      coachId: true,
      programLevel: true,
      student: { select: { fullName: true } },
    },
  });
  if (!existing) return { ok: false, error: "Enrollment not found" };
  if (!(await mayDiscontinue(session, existing))) {
    return { ok: false, error: "Only this student's coach, a Head or an Admin can do that." };
  }
  if (existing.status === DISCONTINUED_STATUS) {
    return { ok: false, error: "This enrollment is already discontinued." };
  }
  /**
   * A COMPLETED programme cannot be discontinued.
   *
   * Not a technicality: `hasLeft` treats the two the same for seats and registers, so the
   * button would appear to do nothing - while quietly rewriting a graduate into churn, which is
   * the one thing that would make the breakdown lie.
   */
  if (existing.status === "COMPLETED") {
    return { ok: false, error: "This programme is already completed - it cannot be discontinued." };
  }

  const config = await getStudentLifecycleConfig();
  const decided = decideDiscontinue(parsed.data, config.discontinueReasons);
  if (!decided.ok) return { ok: false, error: decided.error };
  if (parsed.data.reason === OTHER_REASON && !config.allowOtherReason) {
    return { ok: false, error: "Pick a reason from the list." };
  }

  await prisma.enrollment.update({
    where: { id },
    data: {
      status: DISCONTINUED_STATUS,
      // The one clock. See the schema note: there is no `discontinuedAt` to disagree with it.
      statusChangedAt: new Date(),
      discontinueReason: decided.decision.reason,
      discontinueNote: decided.decision.note,
      discontinuedById: session.user.id,
    },
  });

  await logActivity(session, {
    action: "enrollment.discontinue",
    section: "students",
    entityType: "Enrollment",
    entityId: id,
    summary: `Discontinued ${existing.student.fullName}'s ${existing.programLevel} programme - ${decided.decision.reason}`,
    meta: {
      changed: ["status", "discontinueReason"],
      before: { status: existing.status },
      after: { status: DISCONTINUED_STATUS, discontinueReason: decided.decision.reason },
      note: decided.decision.note,
    },
  });

  revalidatePath("/students");
  revalidatePath("/coaching");
  revalidatePath("/leaderboard");
  revalidatePath("/batches");
  return { ok: true };
}

/**
 * Put a student back.
 *
 * Students come back - a financial problem resolves, a job falls through - and without this the
 * only route back was the Admin's status picker, which would leave the reason attached to a row
 * that now reads ACTIVE. So the three columns are cleared together with the status.
 *
 * The trail is not lost: `logActivity` holds the discontinue (with its reason in `meta`) and
 * this restore, which is the right place for the history of a decision that has been undone.
 */
export async function restoreEnrollment(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const existing = await prisma.enrollment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      coachId: true,
      programLevel: true,
      discontinueReason: true,
      student: { select: { fullName: true } },
    },
  });
  if (!existing) return { ok: false, error: "Enrollment not found" };
  if (!(await mayDiscontinue(session, existing))) {
    return { ok: false, error: "Only this student's coach, a Head or an Admin can do that." };
  }
  if (existing.status !== DISCONTINUED_STATUS) {
    return { ok: false, error: "This enrollment is not discontinued." };
  }

  await prisma.enrollment.update({
    where: { id },
    data: {
      status: "ACTIVE",
      statusChangedAt: new Date(),
      discontinueReason: null,
      discontinueNote: null,
      discontinuedById: null,
    },
  });

  await logActivity(session, {
    action: "enrollment.restore",
    section: "students",
    entityType: "Enrollment",
    entityId: id,
    summary: `Put ${existing.student.fullName} back on their ${existing.programLevel} programme`,
    meta: {
      changed: ["status", "discontinueReason"],
      before: { status: existing.status, discontinueReason: existing.discontinueReason },
      after: { status: "ACTIVE", discontinueReason: null },
    },
  });

  revalidatePath("/students");
  revalidatePath("/coaching");
  revalidatePath("/leaderboard");
  revalidatePath("/batches");
  return { ok: true };
}

// ── 90/120-day tracker (Admin or Head) ─────────────────────────

const trackerSchema = z.object({
  lastSessionDate: z.string().optional(),
  totalSessionsCompleted: z.string().trim().regex(/^\d{0,4}$/).optional(),
  totalSessionsPlanned: z.string().trim().regex(/^\d{0,4}$/).optional(),
  lastTaskAssigned: z.string().trim().optional(),
  lastTaskCompleted: z.enum(["YES", "NO", "PENDING", ""]).optional(),
  applicationsSubmitted: z.string().trim().regex(/^\d{0,5}$/).optional(),
  interviewsReceived: z.string().trim().regex(/^\d{0,5}$/).optional(),
  currentMilestone: z.enum([
    "ONBOARDING", "RESUME_BUILD", "LINKEDIN_OPTIMISATION", "APPLICATIONS", "INTERVIEWS", "OFFER_RECEIVED", "COMPLETED",
  ]),
  signalColour: z.enum(["GREEN", "AMBER", "RED", ""]).optional(),
  signalNotes: optionalRule("text"),
  nextCheckInDate: z.string().optional(),
  milestoneNote: optionalRule("text"),
});

export async function updateTracker(enrollmentId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdminOrHead();
  const parsed = trackerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const existing = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { student: { select: { fullName: true } } },
  });
  if (!existing) return { ok: false, error: "Enrollment not found" };

  const data = {
    lastSessionDate: d.lastSessionDate?.trim() ? parseDateInput(d.lastSessionDate) : null,
    // A blank counter box means "leave it" - never silently reset audited
    // progress to 0 (these feed journey XP and the at-risk radar).
    totalSessionsCompleted: d.totalSessionsCompleted?.trim() ? parseInt(d.totalSessionsCompleted, 10) : existing.totalSessionsCompleted,
    totalSessionsPlanned: d.totalSessionsPlanned?.trim() ? parseInt(d.totalSessionsPlanned, 10) : existing.totalSessionsPlanned,
    lastTaskAssigned: d.lastTaskAssigned || null,
    lastTaskCompleted: d.lastTaskCompleted || null,
    applicationsSubmitted: d.applicationsSubmitted?.trim() ? parseInt(d.applicationsSubmitted, 10) : existing.applicationsSubmitted,
    interviewsReceived: d.interviewsReceived?.trim() ? parseInt(d.interviewsReceived, 10) : existing.interviewsReceived,
    currentMilestone: d.currentMilestone,
    signalColour: d.signalColour || null,
    signalNotes: d.signalNotes || null,
    nextCheckInDate: d.nextCheckInDate?.trim() ? parseDateInput(d.nextCheckInDate) : null,
  };

  await prisma.$transaction(async (tx) => {
    await tx.enrollment.update({ where: { id: enrollmentId }, data });

    // Milestone changed → append immutable history (PRD2 §4.4)
    if (existing.currentMilestone !== d.currentMilestone) {
      await tx.milestoneLog.create({
        data: {
          enrollmentId,
          updatedById: session.user.id,
          previousMilestone: existing.currentMilestone,
          newMilestone: d.currentMilestone,
          note: d.milestoneNote || null,
        },
      });
    }
    // Signal changed → append immutable audit (PRD2 §6). Clearing back to
    // "not set" is a change too - it must land in the trail, not vanish.
    const newSignal = d.signalColour || null;
    if (existing.signalColour !== newSignal) {
      await tx.signalChangeLog.create({
        data: {
          enrollmentId,
          changedById: session.user.id,
          previousSignal: existing.signalColour,
          newSignal,
          note: d.signalNotes || null,
        },
      });
    }
  });

  const diff = diffFields<Record<string, unknown>>(existing, data);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "tracker.update",
      section: "students",
      entityType: "Enrollment",
      entityId: enrollmentId,
      summary: `Updated ${existing.student.fullName}'s tracker - changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after, milestoneNote: d.milestoneNote || null },
    });
  }
  revalidatePath("/students");
  return { ok: true };
}

// ── Sprint tracker (client notes): week-wise targets, Admin or Head ──
// Guided = 13 weeks (90d), Elite = 18 weeks (120d), from the enrollment date.
// The coach sets targets; the weekend check-in records the actual. ACHIEVED =
// "no disturbance"; MISSED feeds the at-risk radar (WhatsApp nudge is Wave-2).

const parseSprintNumber = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

/** Create the empty week plan for a Guided/Elite enrollment (idempotent). */
export async function generateSprintPlan(enrollmentId: string): Promise<ActionResult> {
  const session = await requireAdminOrHead();
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      programLevel: true,
      enrollmentDate: true,
      student: { select: { fullName: true } },
      sprintWeeks: { select: { id: true }, take: 1 },
    },
  });
  if (!e) return { ok: false, error: "Enrollment not found" };
  if (e.programLevel !== "GUIDED" && e.programLevel !== "ELITE") {
    return { ok: false, error: "Sprint plans apply to Guided (90d) and Elite (120d) only" };
  }
  if (e.sprintWeeks.length) return { ok: false, error: "This enrollment already has a sprint plan" };

  const totalDays = e.programLevel === "GUIDED" ? 90 : 120;
  const weeks = Math.ceil(totalDays / 7);
  await prisma.sprintWeek.createMany({
    data: Array.from({ length: weeks }, (_, i) => {
      const weekStart = new Date(e.enrollmentDate);
      weekStart.setUTCDate(weekStart.getUTCDate() + i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
      return { enrollmentId, weekIndex: i + 1, weekStart, weekEnd };
    }),
  });
  // The weeks have no id worth pointing at individually - the enrollment is the entity
  // the founder would click through to.
  await logActivity(session, {
    action: "sprintplan.create",
    section: "students",
    entityType: "Enrollment",
    entityId: enrollmentId,
    summary: `Generated a ${weeks}-week sprint plan for ${e.student.fullName}`,
    meta: { programLevel: e.programLevel, weeks },
  });
  revalidatePath("/students");
  return { ok: true };
}

const sprintWeekSchema = z.object({
  // Prose, deliberately: "15 applications" / "2 interviews, 1 offer" are the real answers.
  target: optionalRule("text"),
  actual: optionalRule("text"),
  status: z.enum(["PENDING", "ACHIEVED", "MISSED"]),
  note: optionalRule("text"),
});

/** Coach/Admin saves one sprint week: target, weekend actual, verdict, note. */
export async function saveSprintWeek(weekId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdminOrHead();
  const parsed = sprintWeekSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const week = await prisma.sprintWeek.findUnique({
    where: { id: weekId },
    include: { enrollment: { select: { student: { select: { fullName: true } } } } },
  });
  if (!week) return { ok: false, error: "Sprint week not found" };

  const data = {
    target: d.target || null,
    targetNumeric: parseSprintNumber(d.target),
    actual: d.actual || null,
    actualNumeric: parseSprintNumber(d.actual),
    status: d.status,
    note: d.note || null,
    enteredById: session.user.id,
  };
  await prisma.sprintWeek.update({ where: { id: weekId }, data });
  const diff = diffFields<Record<string, unknown>>(week, data);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "sprintweek.update",
      section: "students",
      entityType: "SprintWeek",
      entityId: weekId,
      summary: `Saved week ${week.weekIndex} of ${week.enrollment.student.fullName}'s sprint plan - ${d.status}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/students");
  return { ok: true };
}

// ── Satisfaction / recommend score (Admin, manual - PRD2 §4.5) ─────────────

const satisfactionSchema = z.object({
  date: z.string().min(10),
  // Digits-only + bounded, matching the form's `kind="int"` boxes. These stay STRING schemas
  // (that's what intInRange returns) - the create below is what turns them into Ints.
  satisfactionScore: intInRange(1, 10, "Satisfaction score must be"),
  npsScore: intInRange(0, 10, "Recommend score must be"),
  testimonialReceived: z.string().optional(),
  outcomeAchieved: z.enum(["JOB_OFFER_RECEIVED", "INTERVIEWS_ONLY", "APPLICATIONS_STAGE", "NO_OUTCOME_YET"]),
  notes: optionalRule("text"),
});

export async function addSatisfactionScore(studentId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = satisfactionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  // Both are digits-only and range-checked by the schema, so Number() cannot produce NaN here.
  const satisfactionScore = Number(d.satisfactionScore);
  const npsScore = Number(d.npsScore);
  const score = await prisma.satisfactionScore.create({
    data: {
      studentId,
      date: parseDateInput(d.date),
      satisfactionScore,
      npsScore,
      testimonialReceived: d.testimonialReceived === "on",
      outcomeAchieved: d.outcomeAchieved,
      notes: d.notes || null,
    },
    include: { student: { select: { fullName: true } } },
  });
  await logActivity(session, {
    action: "satisfaction.create",
    section: "students",
    entityType: "SatisfactionScore",
    entityId: score.id,
    summary: `Recorded ${score.student.fullName}'s satisfaction ${satisfactionScore}/10, would recommend ${npsScore}/10`,
    meta: {
      satisfactionScore,
      npsScore,
      outcomeAchieved: d.outcomeAchieved,
      testimonialReceived: d.testimonialReceived === "on",
    },
  });
  revalidatePath("/students");
  return { ok: true };
}

// ── Income ↔ student link (CONTEXT §7 manual link picker) ──────

export async function linkIncomeToStudent(incomeId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const studentId = String(form.get("studentId") ?? "");
  const income = await prisma.income.update({
    where: { id: incomeId },
    data: { studentId: studentId || null },
    include: { student: { select: { fullName: true } } },
  });
  await logActivity(session, {
    action: "income.assign",
    section: "students",
    entityType: "Income",
    entityId: incomeId,
    summary: income.student
      ? `Linked the income entry for ${income.studentName} to ${income.student.fullName}`
      : `Unlinked the income entry for ${income.studentName} from its student`,
    meta: { studentId: studentId || null, studentName: income.studentName },
  });
  revalidatePath("/students");
  revalidatePath("/finance");
  return { ok: true };
}

// ── Student portal accounts (Role.STUDENT) ─────────────────────
// Same provisioning trick as users-actions.ts: a local better-auth instance
// with sign-up enabled, only ever called inside admin-guarded actions -
// public sign-up on the real auth instance stays OFF.

const portalAuth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "USER", input: false },
    },
  },
});

const studentLoginSchema = z.object({
  email: rule("email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/** Create a portal login for a student and link it. The account sees ONLY /my-journey + CV check. */
/**
 * Send the student their login - email + WhatsApp - when the admin left "send the login details"
 * ticked. Logs WHICH channels worked, never the password (see server/login-credentials.ts).
 */
async function notifyStudentLogin(
  session: Awaited<ReturnType<typeof requireAdmin>>,
  student: { id: string; fullName: string; phone: string | null },
  userId: string,
  email: string,
  password: string,
  reset: boolean,
): Promise<string> {
  const sent = await sendLoginCredentials({
    name: student.fullName,
    email,
    password,
    phone: student.phone,
    studentId: student.id,
    sentById: session.user.id,
    audience: "student",
    reset,
  });
  await logActivity(session, {
    action: "student.login.notify",
    section: "students",
    entityType: "User",
    entityId: userId,
    summary: `Sent ${student.fullName} their portal login details - ${sent.summary}`,
    meta: { studentId: student.id, emailed: sent.emailed, whatsapped: sent.whatsapped },
  });
  return sent.summary;
}

export async function createStudentLogin(
  studentId: string,
  form: FormData,
): Promise<ActionResult & { message?: string }> {
  const session = await requireAdmin();
  const notify = form.get("notify") === "on";
  const parsed = studentLoginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { ok: false, error: "Student not found" };

  /**
   * A student whose access was revoked keeps their `userId` - revoking suspends the account
   * rather than deleting it, so their watch history and community record survive (see
   * `revokeStudentLogin`). Re-granting therefore has to REINSTATE, not refuse: without this
   * the old "already has a portal login" error made revoke a one-way door, and the only way
   * back was to delete the account by hand and lose exactly what suspension protected.
   */
  if (student.userId) {
    const existing = await prisma.user.findUnique({
      where: { id: student.userId },
      select: { status: true, email: true },
    });
    if (existing?.status !== "SUSPENDED") {
      return { ok: false, error: "This student already has a portal login" };
    }
    const ctx = await portalAuth.$context;
    await ctx.internalAdapter.updatePassword(student.userId, await ctx.password.hash(d.password));
    await prisma.user.update({
      where: { id: student.userId },
      // Same O4 rule as below: an admin chose this password, so the owner replaces it.
      data: { status: "ACTIVE", mustChangePassword: true },
    });
    await logActivity(session, {
      action: "student.login.reinstate",
      section: "students",
      entityType: "User",
      entityId: student.userId,
      summary: `Reinstated ${student.fullName}'s portal login (${existing.email})`,
      meta: { studentId },
    });
    // The reinstated account keeps its ORIGINAL email - that is what they sign in with.
    const message =
      notify && existing?.email
        ? await notifyStudentLogin(session, student, student.userId, existing.email, d.password, true)
        : undefined;
    revalidatePath(`/students/${studentId}`);
    revalidatePath("/people");
    return { ok: true, message };
  }

  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return { ok: false, error: "A user with this email already exists" };

  // signUpEmail can't join a Prisma transaction, so if the role-set + student
  // link fails we delete the just-created account rather than leave an orphan
  // STUDENT login that can sign in but sees nothing.
  let createdUserId: string | null = null;
  try {
    const res = await portalAuth.api.signUpEmail({
      body: { name: student.fullName, email: d.email, password: d.password },
    });
    createdUserId = res.user.id;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: res.user.id },
        data: {
          role: "STUDENT",
          emailVerified: true,
          /**
           * The app's own rule (O4), which this path was the one exception to: "the admin
           * chose this password, so the owner must replace it on next sign-in". Team members
           * never hit it because they set their own password through an invite; students have
           * no invite flow, so an admin types their password and - until now - it stayed that
           * password, known to the admin, indefinitely.
           */
          mustChangePassword: true,
        },
      }),
      prisma.student.update({ where: { id: studentId }, data: { userId: res.user.id } }),
    ]);
    // The chosen password is never recorded - only that access now exists, and for whom.
    await logActivity(session, {
      action: "student.login.create",
      section: "students",
      entityType: "User",
      entityId: res.user.id,
      summary: `Created a portal login for ${student.fullName} (${d.email})`,
      meta: { email: d.email, studentId },
    });
  } catch (e) {
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
    }
    console.error("createStudentLogin failed", e);
    return { ok: false, error: "Could not create the login - please try again" };
  }
  // Outside the try on purpose: the login exists now, and a failed email or WhatsApp must not be
  // mistaken for a failed signup and roll the account back.
  const message =
    notify && createdUserId
      ? await notifyStudentLogin(session, student, createdUserId, d.email, d.password, false)
      : undefined;
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/people");
  return { ok: true, message };
}

/**
 * Remove a student's portal access. The student record - and their history - stays.
 *
 * ── Why this suspends rather than deletes ───────────────────────────────────────
 * It used to call `user.delete`, with a comment saying the student record was untouched.
 * The student ROW was; a good deal of their work was not. `GnRecordingWatch`, `GnLike` and
 * `GnCommentLike` all cascade from User, so deleting the account silently erased:
 *
 *   · every recording the student had watched, and the watch percentages that drive their
 *     batch's course-progress bars and auto-complete WATCH_VIDEO coursework;
 *   · every like they had given, quietly decrementing other people's community points and
 *     the leaderboard those points feed.
 *
 * Posts and comments survived (both SetNull, rendering as "Former member"), which is what
 * made the loss easy to miss - the visible things stayed and the measured things went.
 *
 * Suspension revokes access just as completely: `requireSession` bounces a SUSPENDED user
 * on the very next request and deletes their sessions again on the way past. The difference
 * is only that the evidence of their time in the programme survives it, which is what a
 * coach looking back at a dropped student actually needs.
 */
export async function revokeStudentLogin(studentId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student?.userId) return { ok: false, error: "This student has no portal login" };
  await prisma.$transaction([
    prisma.user.update({ where: { id: student.userId }, data: { status: "SUSPENDED" } }),
    // Takes effect immediately rather than at their next page load.
    prisma.session.deleteMany({ where: { userId: student.userId } }),
  ]);
  await logActivity(session, {
    action: "student.login.revoke",
    section: "students",
    entityType: "User",
    entityId: student.userId,
    summary: `Revoked ${student.fullName}'s portal login`,
    meta: { studentId },
  });
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/people");
  return { ok: true };
}

/**
 * ── BATCH TRACKER UPDATE ────────────────────────────────────────────────────────
 * One coach, one screen, every student they are updating this week.
 *
 * This is what replaces the Google Form. The per-student `updateTracker` above has always
 * existed and is fine for one student; the reason a form outside the app was being used at all
 * is that updating twelve students meant opening twelve pages. This takes the whole week's round
 * in one submit.
 *
 * ── Why it reuses `updateTracker` rather than writing its own update ────────────
 * Every tracker write must append a `MilestoneLog` when the milestone moves and a
 * `SignalChangeLog` when the colour changes - those two audit trails feed the at-risk radar, the
 * journey XP and the student's own timeline. A second write path would inevitably drift from
 * the first, and the drift would be silent: the data would look updated and the history would be
 * missing. So this is a LOOP over the audited action, not a bulk SQL update.
 *
 * ── Partial success is real and is reported ────────────────────────────────────
 * Each row is independent. One bad row (a stale enrollment, a validation slip) must not discard
 * eleven good ones, so failures are collected and named rather than thrown. A silent partial
 * save is the worst outcome available here - the coach would believe the round was recorded.
 */
export type BatchTrackerResult =
  | { ok: true; updated: number; skipped: number; failures: { name: string; error: string }[] }
  | { ok: false; error: string };

/** Bounded: a coach's weekly round, not an import. Larger sets belong in the CSV importer. */
const MAX_BATCH_ROWS = 60;

export async function updateTrackerBatch(form: FormData): Promise<BatchTrackerResult> {
  await requireAdminOrHead();

  /**
   * The client posts one flat FormData with every field namespaced `<enrollmentId>__<field>`,
   * plus `touched` listing the rows the coach actually edited.
   *
   * `touched` is what makes the "leave it alone" case safe. Submitting every visible row would
   * re-save a student nobody touched, which is harmless for values but NOT for the audit trail:
   * a re-saved identical milestone writes no log (the action compares first), but a re-saved row
   * still bumps `updatedAt` and would make "last updated" useless as a signal of attention.
   */
  const touched = form.getAll("touched").map(String).filter(Boolean);
  if (touched.length === 0) return { ok: true, updated: 0, skipped: 0, failures: [] };
  if (touched.length > MAX_BATCH_ROWS) {
    return { ok: false, error: `That is more than ${MAX_BATCH_ROWS} students at once - save in smaller batches.` };
  }

  const names = new Map(
    (
      await prisma.enrollment.findMany({
        where: { id: { in: touched } },
        select: { id: true, student: { select: { fullName: true } } },
      })
    ).map((e) => [e.id, e.student.fullName]),
  );

  let updated = 0;
  const failures: { name: string; error: string }[] = [];

  for (const enrollmentId of touched) {
    const name = names.get(enrollmentId) ?? "Unknown student";
    if (!names.has(enrollmentId)) {
      failures.push({ name, error: "That enrollment no longer exists - reload the page." });
      continue;
    }

    // Rebuild this row's own FormData from the namespaced keys.
    const row = new FormData();
    const prefix = `${enrollmentId}__`;
    for (const [key, value] of form.entries()) {
      if (key.startsWith(prefix)) row.set(key.slice(prefix.length), value);
    }

    const res = await updateTracker(enrollmentId, row);
    if (res.ok) updated++;
    else failures.push({ name, error: res.error });
  }

  revalidatePath("/students");
  return { ok: true, updated, skipped: touched.length - updated - failures.length, failures };
}
