"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSession } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import type { ActionResult } from "./finance-actions";

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
  fullName: z.string().trim().min(1, "Full name is required"),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  targetRole: z.string().trim().optional(),
  leadSource: z
    .enum(["INSTAGRAM", "YOUTUBE", "LINKEDIN", "WHATSAPP", "REFERRAL", "SUMMIT", "WORKSHOP", "GHOSTED_BLUEPRINT", "OTHER"])
    .optional()
    .or(z.literal("")),
  internalNotes: z.string().trim().optional(),
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
  await requireAdmin();
  const s = studentSchema.safeParse(Object.fromEntries(form));
  const e = enrollmentSchema.safeParse(Object.fromEntries(form));
  if (!s.success) return { ok: false, error: firstError(s.error) };
  if (!e.success) return { ok: false, error: firstError(e.error) };

  const start = parseDateInput(e.data.enrollmentDate);
  const { duration, programEndDate } = derivedDuration(e.data.programLevel, start);

  const student = await prisma.student.create({
    data: {
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
  revalidatePath("/students");
  revalidatePath("/finance");
  return { ok: true };
}

export async function updateStudent(id: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const s = studentSchema.safeParse(Object.fromEntries(form));
  if (!s.success) return { ok: false, error: firstError(s.error) };
  await prisma.student.update({
    where: { id },
    data: {
      fullName: s.data.fullName,
      email: s.data.email || null,
      phone: s.data.phone || null,
      industry: s.data.industry || null,
      targetRole: s.data.targetRole || null,
      leadSource: s.data.leadSource || null,
      internalNotes: s.data.internalNotes || null,
    },
  });
  revalidatePath("/students");
  return { ok: true };
}

export async function deleteStudent(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.income.updateMany({ where: { studentId: id }, data: { studentId: null } });
  await prisma.student.delete({ where: { id } });
  revalidatePath("/students");
  return { ok: true };
}

/** Upgrade path (Solo → Guided etc.): SAME student, NEW enrollment (CONTEXT §7). */
export async function addEnrollment(studentId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const e = enrollmentSchema.safeParse(Object.fromEntries(form));
  if (!e.success) return { ok: false, error: firstError(e.error) };
  const start = parseDateInput(e.data.enrollmentDate);
  const { duration, programEndDate } = derivedDuration(e.data.programLevel, start);
  await prisma.enrollment.create({
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
  });
  revalidatePath("/students");
  return { ok: true };
}

/** Set / change the L3 closer (sales-call rep) on an enrollment — the third leg of the
 *  commission split. An empty id clears it. */
export async function setEnrollmentCloser(enrollmentId: string, closerId: string): Promise<ActionResult> {
  await requireAdmin();
  const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { id: true } });
  if (!enrollment) return { ok: false, error: "Enrollment not found" };
  if (closerId) {
    const user = await prisma.user.findUnique({ where: { id: closerId }, select: { id: true } });
    if (!user) return { ok: false, error: "Closer not found" };
  }
  await prisma.enrollment.update({ where: { id: enrollmentId }, data: { closerId: closerId || null } });
  revalidatePath("/students");
  return { ok: true };
}

const statusSchema = z.enum(["ACTIVE", "COMPLETED", "DROPPED", "PAUSED"]);

export async function setEnrollmentStatus(id: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const status = statusSchema.safeParse(form.get("status"));
  if (!status.success) return { ok: false, error: "Invalid status" };
  const existing = await prisma.enrollment.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Enrollment not found" };
  if (existing.status !== status.data) {
    await prisma.enrollment.update({
      where: { id },
      data: { status: status.data, statusChangedAt: new Date() },
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
  signalNotes: z.string().trim().optional(),
  nextCheckInDate: z.string().optional(),
  milestoneNote: z.string().trim().optional(),
});

export async function updateTracker(enrollmentId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdminOrHead();
  const parsed = trackerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const existing = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!existing) return { ok: false, error: "Enrollment not found" };

  await prisma.$transaction(async (tx) => {
    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: {
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
      },
    });

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
  await requireAdminOrHead();
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { programLevel: true, enrollmentDate: true, sprintWeeks: { select: { id: true }, take: 1 } },
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
  revalidatePath("/students");
  return { ok: true };
}

const sprintWeekSchema = z.object({
  target: z.string().trim().optional(),
  actual: z.string().trim().optional(),
  status: z.enum(["PENDING", "ACHIEVED", "MISSED"]),
  note: z.string().trim().optional(),
});

/** Coach/Admin saves one sprint week: target, weekend actual, verdict, note. */
export async function saveSprintWeek(weekId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdminOrHead();
  const parsed = sprintWeekSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const week = await prisma.sprintWeek.findUnique({ where: { id: weekId }, select: { id: true } });
  if (!week) return { ok: false, error: "Sprint week not found" };

  await prisma.sprintWeek.update({
    where: { id: weekId },
    data: {
      target: d.target || null,
      targetNumeric: parseSprintNumber(d.target),
      actual: d.actual || null,
      actualNumeric: parseSprintNumber(d.actual),
      status: d.status,
      note: d.note || null,
      enteredById: session.user.id,
    },
  });
  revalidatePath("/students");
  return { ok: true };
}

// ── Satisfaction / NPS (Admin, manual - PRD2 §4.5) ─────────────

const satisfactionSchema = z.object({
  date: z.string().min(10),
  satisfactionScore: z.coerce.number().int().min(1).max(10),
  npsScore: z.coerce.number().int().min(0).max(10),
  testimonialReceived: z.string().optional(),
  outcomeAchieved: z.enum(["JOB_OFFER_RECEIVED", "INTERVIEWS_ONLY", "APPLICATIONS_STAGE", "NO_OUTCOME_YET"]),
  notes: z.string().trim().optional(),
});

export async function addSatisfactionScore(studentId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = satisfactionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  await prisma.satisfactionScore.create({
    data: {
      studentId,
      date: parseDateInput(d.date),
      satisfactionScore: d.satisfactionScore,
      npsScore: d.npsScore,
      testimonialReceived: d.testimonialReceived === "on",
      outcomeAchieved: d.outcomeAchieved,
      notes: d.notes || null,
    },
  });
  revalidatePath("/students");
  return { ok: true };
}

// ── Income ↔ student link (CONTEXT §7 manual link picker) ──────

export async function linkIncomeToStudent(incomeId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const studentId = String(form.get("studentId") ?? "");
  await prisma.income.update({
    where: { id: incomeId },
    data: { studentId: studentId || null },
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
  email: z.string().trim().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/** Create a portal login for a student and link it. The account sees ONLY /my-journey + CV check. */
export async function createStudentLogin(studentId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
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
  await requireAdmin();
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student?.userId) return { ok: false, error: "This student has no portal login" };
  // Cascades sessions/accounts; Student.userId is ON DELETE SET NULL.
  await prisma.user.delete({ where: { id: student.userId } });
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/people");
  return { ok: true };
}
