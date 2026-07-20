"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSession } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { intInRange, optionalRule, rule } from "@/lib/field-rules";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";
import { allocateStudentCode } from "./student-code";

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

const studentSchema = z.object({
  fullName: rule("name"),
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

export async function createStudent(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const s = studentSchema.safeParse(Object.fromEntries(form));
  const e = enrollmentSchema.safeParse(Object.fromEntries(form));
  if (!s.success) return { ok: false, error: firstError(s.error) };
  if (!e.success) return { ok: false, error: firstError(e.error) };

  const start = parseDateInput(e.data.enrollmentDate);
  const { duration, programEndDate } = derivedDuration(e.data.programLevel, start);

  const student = await prisma.student.create({
    data: {
      code: await allocateStudentCode(),
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
          assignedCoach: e.data.assignedCoach || "Karthick",
          closerId: e.data.closerId || null,
          milestoneLogs: { create: { newMilestone: "ONBOARDING" } },
        },
      },
    },
  });

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
    summary: `Enrolled ${student.fullName} — ${e.data.programLevel}`,
    meta: {
      programLevel: e.data.programLevel,
      enrollmentDate: e.data.enrollmentDate,
      assignedCoach: e.data.assignedCoach || "Karthick",
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
 * stay joined. No enrollment is created — the program level isn't known at convert time; the
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

  // Same name-match backfill createStudent does — a payment recorded before conversion links up.
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
  const data = {
    fullName: s.data.fullName,
    email: s.data.email || null,
    phone: s.data.phone || null,
    industry: s.data.industry || null,
    targetRole: s.data.targetRole || null,
    leadSource: s.data.leadSource || null,
    internalNotes: s.data.internalNotes || null,
  };
  const before = await prisma.student.findUnique({ where: { id } });
  await prisma.student.update({ where: { id }, data });
  const diff = before
    ? diffFields<Record<string, unknown>>(before, data)
    : { changed: [], before: {}, after: {} };
  if (diff.changed.length) {
    await logActivity(session, {
      action: "student.update",
      section: "students",
      entityType: "Student",
      entityId: id,
      summary: `Updated ${data.fullName} — changed ${diff.changed.join(", ")}`,
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
      assignedCoach: e.data.assignedCoach || "Karthick",
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
      assignedCoach: e.data.assignedCoach || "Karthick",
    },
  });
  revalidatePath("/students");
  return { ok: true };
}

/** Set / change the L3 closer (sales-call rep) on an enrollment — the third leg of the
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
    // A blank counter box means "leave it" — never silently reset audited
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
      summary: `Updated ${existing.student.fullName}'s tracker — changed ${diff.changed.join(", ")}`,
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
  // The weeks have no id worth pointing at individually — the enrollment is the entity
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
      summary: `Saved week ${week.weekIndex} of ${week.enrollment.student.fullName}'s sprint plan — ${d.status}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/students");
  return { ok: true };
}

// ── Satisfaction / NPS (Admin, manual - PRD2 §4.5) ─────────────

const satisfactionSchema = z.object({
  date: z.string().min(10),
  // Digits-only + bounded, matching the form's `kind="int"` boxes. These stay STRING schemas
  // (that's what intInRange returns) — the create below is what turns them into Ints.
  satisfactionScore: intInRange(1, 10, "Satisfaction score must be"),
  npsScore: intInRange(0, 10, "NPS score must be"),
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
    summary: `Recorded ${score.student.fullName}'s satisfaction ${satisfactionScore}/10, NPS ${npsScore}/10`,
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
// with sign-up enabled, only ever called inside admin-guarded actions —
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
export async function createStudentLogin(studentId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = studentLoginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return { ok: false, error: "Student not found" };
  if (student.userId) return { ok: false, error: "This student already has a portal login" };

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
        data: { role: "STUDENT", emailVerified: true },
      }),
      prisma.student.update({ where: { id: studentId }, data: { userId: res.user.id } }),
    ]);
    // The chosen password is never recorded — only that access now exists, and for whom.
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
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/people");
  return { ok: true };
}

/** Remove a student's portal access entirely (account + sessions). The student record stays. */
export async function revokeStudentLogin(studentId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student?.userId) return { ok: false, error: "This student has no portal login" };
  // Cascades sessions/accounts; Student.userId is ON DELETE SET NULL.
  await prisma.user.delete({ where: { id: student.userId } });
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
