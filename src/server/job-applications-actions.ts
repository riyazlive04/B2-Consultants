"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Per-application placement tracking (spec Module I). Richer than the aggregate
 * applicationsSubmitted / interviewsReceived counters on Enrollment (which stay as the
 * tracker headline): one row per real application moving applied → interview →
 * selected/rejected. Same access as the 90/120 tracker — Admin OR Head (Karthick).
 */

async function requireAdminOrHead() {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "HEAD") throw new Error("Not allowed");
  return session;
}

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const STATUSES = ["APPLIED", "INTERVIEW", "SELECTED", "REJECTED"] as const;

const applicationSchema = z.object({
  company: z.string().trim().min(1, "Company is required").max(160),
  role: z.string().trim().min(1, "Role is required").max(160),
  jobUrl: z.string().trim().url("Enter a valid job URL").max(500).optional().or(z.literal("")),
  location: z.string().trim().max(160).optional(),
  appliedAt: z.string().min(10, "Applied date is required"),
  status: z.enum(STATUSES).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createJobApplication(enrollmentId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdminOrHead();
  const parsed = applicationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, student: { select: { fullName: true } } },
  });
  if (!enrollment) return { ok: false, error: "Enrollment not found" };

  const application = await prisma.jobApplication.create({
    data: {
      enrollmentId,
      company: d.company,
      role: d.role,
      jobUrl: d.jobUrl || null,
      location: d.location || null,
      status: d.status ?? "APPLIED",
      appliedAt: parseDateInput(d.appliedAt),
      notes: d.notes || null,
    },
  });
  await logActivity(session, {
    action: "job-application.create",
    section: "students",
    entityType: "JobApplication",
    entityId: application.id,
    summary: `Added a ${application.role} application to ${application.company} for ${enrollment.student.fullName}`,
    meta: { enrollmentId, status: application.status, appliedAt: d.appliedAt },
  });
  revalidatePath("/students");
  return { ok: true };
}

export async function updateJobApplicationStatus(id: string, status: string): Promise<ActionResult> {
  const session = await requireAdminOrHead();
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Invalid status" };
  const app = await prisma.jobApplication.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      company: true,
      enrollment: { select: { student: { select: { fullName: true } } } },
    },
  });
  if (!app) return { ok: false, error: "Application not found" };
  await prisma.jobApplication.update({
    where: { id },
    data: { status: status as (typeof STATUSES)[number], statusAt: new Date() },
  });
  const diff = diffFields({ status: app.status }, { status: status as (typeof STATUSES)[number] });
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "job-application.update",
      section: "students",
      entityType: "JobApplication",
      entityId: id,
      summary: `Moved ${app.enrollment.student.fullName}'s ${app.company} application to ${status.toLowerCase()}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/students");
  return { ok: true };
}

export async function deleteJobApplication(id: string): Promise<ActionResult> {
  const session = await requireAdminOrHead();
  const application = await prisma.jobApplication.delete({ where: { id } });
  await logActivity(session, {
    action: "job-application.delete",
    section: "students",
    entityType: "JobApplication",
    entityId: id,
    summary: `Deleted the ${application.role} application to ${application.company}`,
    meta: { enrollmentId: application.enrollmentId, status: application.status },
  });
  revalidatePath("/students");
  return { ok: true };
}
