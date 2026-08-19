"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Job descriptions (ER v2 Track H).
 *
 * A REUSABLE JD, so the same posting can be matched against many CVs and applied to by many
 * students - previously a JD existed only as free text pasted into one review, which meant
 * "how did our students do against this role" could not be asked.
 *
 * `ResumeReview.jdText` STAYS as the frozen snapshot of what was actually matched: a JD can
 * be edited afterwards, and a review must show the text it scored, not today's version.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const jdSchema = z.object({
  title: z.string().trim().min(1, "Job title is required").max(200),
  company: z.string().trim().min(1, "Company is required").max(200),
  location: z.string().trim().max(200).optional(),
  url: z.string().trim().max(2000).optional(),
  language: z.enum(["EN", "DE"]).default("EN"),
  text: z.string().trim().min(20, "Paste the job description text"),
});

export async function upsertJobDescription(jdId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireSection("cv-check");
  const parsed = jdSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const data = {
    title: d.title,
    company: d.company,
    location: d.location || null,
    url: d.url || null,
    language: d.language,
    text: d.text,
  };

  const jd = jdId
    ? await prisma.jobDescription.update({ where: { id: jdId }, data })
    : await prisma.jobDescription.create({ data: { ...data, createdById: session.user.id } });

  await logActivity(session, {
    action: jdId ? "jd.update" : "jd.create",
    section: "cv-check",
    entityType: "JobDescription",
    entityId: jd.id,
    summary: `${jdId ? "Updated" : "Added"} the job description "${d.title}" at ${d.company}`,
    meta: {},
  });

  revalidatePath("/cv-check");
  return { ok: true };
}

/**
 * Retire a JD. Never a delete: reviews and applications cite it, and a retired posting is
 * still the correct answer to "what did we match against last March".
 */
export async function setJobDescriptionActive(jdId: string, active: boolean): Promise<ActionResult> {
  const session = await requireSection("cv-check");
  const jd = await prisma.jobDescription.findUnique({ where: { id: jdId }, select: { title: true, company: true } });
  if (!jd) return { ok: false, error: "Job description not found" };

  await prisma.jobDescription.update({ where: { id: jdId }, data: { active } });
  await logActivity(session, {
    action: active ? "jd.restore" : "jd.retire",
    section: "cv-check",
    entityType: "JobDescription",
    entityId: jdId,
    summary: `${active ? "Restored" : "Retired"} "${jd.title}" at ${jd.company}`,
    meta: {},
  });

  revalidatePath("/cv-check");
  return { ok: true };
}

/** Attach a resume to a student - the ER's `STUDENT ||--o{ CV`. */
export async function linkResumeToStudent(resumeId: string, studentId: string | null): Promise<ActionResult> {
  const session = await requireSection("cv-check");
  const resume = await prisma.resume.findUnique({ where: { id: resumeId }, select: { title: true } });
  if (!resume) return { ok: false, error: "Resume not found" };

  if (studentId) {
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) return { ok: false, error: "Student not found" };
  }

  await prisma.resume.update({ where: { id: resumeId }, data: { studentId } });
  await logActivity(session, {
    action: "resume.link_student",
    section: "cv-check",
    entityType: "Resume",
    entityId: resumeId,
    summary: studentId ? `Linked the CV "${resume.title}" to a student` : `Unlinked the CV "${resume.title}"`,
    meta: { studentId },
  });

  revalidatePath("/cv-check");
  return { ok: true };
}

export async function listJobDescriptions(activeOnly = true) {
  return prisma.jobDescription.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, title: true, company: true, location: true, url: true,
      language: true, active: true, createdAt: true,
      _count: { select: { reviews: true, applications: true } },
    },
  });
}
