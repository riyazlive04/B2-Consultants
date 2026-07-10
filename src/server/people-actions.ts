"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSection, requireSession } from "@/lib/rbac";
import { istToday } from "@/lib/dates";
import type { ActionResult } from "./finance-actions";

/** People section (PRD2 §3). Profiles/OKR-setting/org order = Admin.
 *  Daily logs + own OKR progress = each member, via /daily-log. */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

// ── Team profiles ──────────────────────────────────────────────

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  roleTitle: z.string().trim().min(1, "Role title is required"),
  dashboardRole: z.enum(["ADMIN", "HEAD", "USER"]),
  email: z.string().trim().email("Valid login email required"),
  phone: z.string().trim().optional(),
  dateJoined: z.string().optional(),
  keyResponsibilities: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE"]),
  logVariant: z.enum(["DISCOVERY_SPECIALIST", "APPOINTMENT_SETTER", "DELIVERY_COACH"]),
  // First-call rotation (client notes: 80/20 split, Asma off Saturdays)
  firstCallSharePct: z.string().trim().regex(/^\d{0,3}$/, "Share must be 0-100").optional(),
  worksSaturdays: z.string().optional(), // checkbox
});

export async function saveTeamProfile(id: string | null, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = profileSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const data = {
    fullName: d.fullName,
    roleTitle: d.roleTitle,
    dashboardRole: d.dashboardRole,
    email: d.email,
    phone: d.phone || null,
    dateJoined: d.dateJoined?.trim() ? new Date(`${d.dateJoined}T00:00:00Z`) : null,
    keyResponsibilities: d.keyResponsibilities || null,
    status: d.status,
    logVariant: d.logVariant,
    firstCallSharePct: Math.min(100, d.firstCallSharePct?.trim() ? parseInt(d.firstCallSharePct, 10) : 0),
    worksSaturdays: d.worksSaturdays === "on",
  };

  if (id) {
    await prisma.teamProfile.update({ where: { id }, data });
  } else {
    const max = await prisma.teamProfile.aggregate({ _max: { orderIndex: true } });
    // link to the login user with the same email, if one exists
    const user = await prisma.user.findUnique({ where: { email: d.email } });
    await prisma.teamProfile.create({
      data: { ...data, orderIndex: (max._max.orderIndex ?? 0) + 1, userId: user?.id ?? null },
    });
  }
  // keep the login role in sync when the profile is linked to a user
  const profile = await prisma.teamProfile.findFirst({ where: { email: d.email }, select: { userId: true } });
  if (profile?.userId) {
    await prisma.user.update({ where: { id: profile.userId }, data: { role: d.dashboardRole } });
  }
  revalidatePath("/people");
  return { ok: true };
}

/** Org-chart card order (display only, Admin rearranges) - swap with neighbour. */
export async function moveProfile(id: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireAdmin();
  const all = await prisma.teamProfile.findMany({ orderBy: { orderIndex: "asc" } });
  const idx = all.findIndex((p) => p.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= all.length) return { ok: true };
  await prisma.$transaction([
    prisma.teamProfile.update({ where: { id: all[idx].id }, data: { orderIndex: all[swapWith].orderIndex } }),
    prisma.teamProfile.update({ where: { id: all[swapWith].id }, data: { orderIndex: all[idx].orderIndex } }),
  ]);
  revalidatePath("/people");
  return { ok: true };
}

// ── OKRs ───────────────────────────────────────────────────────

const okrSchema = z.object({
  teamProfileId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  title: z.string().trim().min(1, "OKR title is required"),
  targetValue: z.string().trim().min(1, "Target value is required"),
  currentProgress: z.string().trim().optional(),
  manualCompletionPct: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const parseNumeric = (s: string | undefined | null): number | null => {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

export async function saveOkr(id: string | null, form: FormData): Promise<ActionResult> {
  await requireAdmin(); // Admin sets OKRs (PRD2 §3.2)
  const parsed = okrSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const month = new Date(`${d.month}-01T00:00:00Z`);

  if (!id) {
    // HARD RULE: max 3 OKRs per person per month (PRD2 §3.2)
    const count = await prisma.oKR.count({ where: { teamProfileId: d.teamProfileId, month } });
    if (count >= 3) {
      return { ok: false, error: "Maximum 3 OKRs per person per month - remove one first." };
    }
  }

  const manualPct = d.manualCompletionPct?.trim() ? parseInt(d.manualCompletionPct, 10) : null;
  if (manualPct !== null && (Number.isNaN(manualPct) || manualPct < 0 || manualPct > 100)) {
    return { ok: false, error: "Manual completion % must be 0-100" };
  }

  const data = {
    teamProfileId: d.teamProfileId,
    month,
    title: d.title,
    targetValue: d.targetValue,
    targetNumeric: parseNumeric(d.targetValue),
    currentProgress: d.currentProgress || null,
    currentNumeric: parseNumeric(d.currentProgress),
    manualCompletionPct: manualPct,
    notes: d.notes || null,
  };
  if (id) await prisma.oKR.update({ where: { id }, data });
  else await prisma.oKR.create({ data });
  revalidatePath("/people");
  return { ok: true };
}

export async function deleteOkr(id: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.oKR.delete({ where: { id } });
  revalidatePath("/people");
  return { ok: true };
}

/** Team members update their own progress weekly (PRD2 §3.2) - from /daily-log. */
export async function updateOwnOkrProgress(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const okr = await prisma.oKR.findUnique({ where: { id }, include: { teamProfile: true } });
  if (!okr) return { ok: false, error: "OKR not found" };
  if (session.role !== "ADMIN" && okr.teamProfile.userId !== session.user.id) {
    return { ok: false, error: "You can only update your own OKRs" };
  }
  const progress = String(form.get("currentProgress") ?? "").trim();
  await prisma.oKR.update({
    where: { id },
    data: { currentProgress: progress || null, currentNumeric: parseNumeric(progress) },
  });
  revalidatePath("/daily-log");
  revalidatePath("/people");
  return { ok: true };
}

// ── Daily activity logs ────────────────────────────────────────

const num = z
  .string()
  .trim()
  .regex(/^\d{0,6}$/, "Numbers only")
  .transform((s) => (s === "" ? null : parseInt(s, 10)));

const logSchema = z.object({
  variant: z.enum(["DISCOVERY_SPECIALIST", "APPOINTMENT_SETTER", "DELIVERY_COACH"]),
  discoveryCallsCompleted: num.optional(),
  highlyQualifiedCalls: num.optional(),
  followUpsDone: num.optional(),
  proposalsSent: num.optional(),
  noShows: num.optional(),
  newLeadsContacted: num.optional(),
  appointmentsSet: num.optional(),
  followUpMessagesSent: num.optional(),
  leadsAddedToPipeline: num.optional(),
  sessionsDelivered: num.optional(),
  studentsCheckedInOn: num.optional(),
  assignmentsReviewed: num.optional(),
  studentsFlaggedAtRisk: num.optional(),
  notes: z.string().trim().optional(),
});

export async function submitDailyLog(form: FormData): Promise<ActionResult> {
  // Same guard as the /daily-log page (HEAD/USER + overrides) — requireSession
  // alone would let a STUDENT account write daily-log rows.
  const session = await requireSection("daily-log");
  const parsed = logSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const today = istToday(); // date auto-filled as today; future dates impossible (PRD2 §3.3)
  const existing = await prisma.dailyLog.findUnique({
    where: { userId_date: { userId: session.user.id, date: today } },
  });
  if (existing) {
    return { ok: false, error: "You have already submitted today. Contact Admin to make changes." };
  }

  try {
    await prisma.dailyLog.create({
    data: {
      userId: session.user.id,
      date: today,
      variant: d.variant,
      discoveryCallsCompleted: d.discoveryCallsCompleted ?? null,
      highlyQualifiedCalls: d.highlyQualifiedCalls ?? null,
      followUpsDone: d.followUpsDone ?? null,
      proposalsSent: d.proposalsSent ?? null,
      noShows: d.noShows ?? null,
      newLeadsContacted: d.newLeadsContacted ?? null,
      appointmentsSet: d.appointmentsSet ?? null,
      followUpMessagesSent: d.followUpMessagesSent ?? null,
      leadsAddedToPipeline: d.leadsAddedToPipeline ?? null,
      sessionsDelivered: d.sessionsDelivered ?? null,
      studentsCheckedInOn: d.studentsCheckedInOn ?? null,
      assignmentsReviewed: d.assignmentsReviewed ?? null,
      studentsFlaggedAtRisk: d.studentsFlaggedAtRisk ?? null,
      notes: d.notes || null,
    },
    });
  } catch (e) {
    // The friendly pre-check above can race a double-submit; the @@unique on
    // (userId, date) is the real guard - surface it as the same message.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "You have already submitted today. Contact Admin to make changes." };
    }
    throw e;
  }
  revalidatePath("/daily-log");
  revalidatePath("/people");
  return { ok: true };
}

/** Admin appends a correction note; the original entry is immutable (PRD2 §6). */
export async function addLogCorrection(logId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const note = String(form.get("correctionNote") ?? "").trim();
  if (!note) return { ok: false, error: "Correction note cannot be empty" };
  await prisma.dailyLog.update({ where: { id: logId }, data: { correctionNote: note } });
  revalidatePath("/people");
  return { ok: true };
}
