"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { parseDateInput } from "@/lib/dates";
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
  await requireAdminOrHead();
  const parsed = applicationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { id: true } });
  if (!enrollment) return { ok: false, error: "Enrollment not found" };

  await prisma.jobApplication.create({
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
  revalidatePath("/students");
  return { ok: true };
}

export async function updateJobApplicationStatus(id: string, status: string): Promise<ActionResult> {
  await requireAdminOrHead();
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Invalid status" };
  const app = await prisma.jobApplication.findUnique({ where: { id }, select: { id: true } });
  if (!app) return { ok: false, error: "Application not found" };
  await prisma.jobApplication.update({
    where: { id },
    data: { status: status as (typeof STATUSES)[number], statusAt: new Date() },
  });
  revalidatePath("/students");
  return { ok: true };
}

export async function deleteJobApplication(id: string): Promise<ActionResult> {
  await requireAdminOrHead();
  await prisma.jobApplication.delete({ where: { id } });
  revalidatePath("/students");
  return { ok: true };
}
