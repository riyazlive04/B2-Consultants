"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSection, requireSession } from "@/lib/rbac";
import { istMinutesOfDay, istToday } from "@/lib/dates";
import { formatIstMinutes } from "@/lib/config-schema";
import { activityDate } from "@/lib/activity-actions";
import { getDailyLogEod } from "./founder-config";
import { logActivity, diffFields } from "./activity-log";
import { LOG_FIELD_UNIT } from "@/lib/labels";
import type { ActionResult } from "./finance-actions";

/** The numeric daily-log field keys — the allowed values for the auto-captured record. */
const LOG_NUMERIC_KEYS = new Set(Object.keys(LOG_FIELD_UNIT));

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
  // How many calls a day this person is expected to make — drives the My Desk bar and the
  // once-a-day greeting. Blank/0 = no target, which hides the bar rather than showing 0/0.
  dailyCallTarget: z.string().trim().regex(/^\d{0,3}$/, "Daily call target must be 0-999").optional(),
});

export async function saveTeamProfile(id: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
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
    dailyCallTarget: Math.min(999, d.dailyCallTarget?.trim() ? parseInt(d.dailyCallTarget, 10) : 0),
  };

  if (id) {
    const before = await prisma.teamProfile.findUnique({ where: { id } });
    await prisma.teamProfile.update({ where: { id }, data });
    const diff = before
      ? diffFields<Record<string, unknown>>(before, data)
      : { changed: [], before: {}, after: {} };
    if (diff.changed.length) {
      await logActivity(session, {
        action: "profile.update",
        section: "people",
        entityType: "TeamProfile",
        entityId: id,
        summary: `Updated ${d.fullName}'s team profile — changed ${diff.changed.join(", ")}`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  } else {
    const max = await prisma.teamProfile.aggregate({ _max: { orderIndex: true } });
    // link to the login user with the same email, if one exists
    const user = await prisma.user.findUnique({ where: { email: d.email } });
    const created = await prisma.teamProfile.create({
      data: { ...data, orderIndex: (max._max.orderIndex ?? 0) + 1, userId: user?.id ?? null },
    });
    await logActivity(session, {
      action: "profile.create",
      section: "people",
      entityType: "TeamProfile",
      entityId: created.id,
      summary: `Added ${d.fullName} to the team — ${d.roleTitle}`,
      meta: { roleTitle: d.roleTitle, dashboardRole: d.dashboardRole, email: d.email, linked: !!user },
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
  const session = await requireAdmin();
  const all = await prisma.teamProfile.findMany({ orderBy: { orderIndex: "asc" } });
  const idx = all.findIndex((p) => p.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= all.length) return { ok: true };
  await prisma.$transaction([
    prisma.teamProfile.update({ where: { id: all[idx].id }, data: { orderIndex: all[swapWith].orderIndex } }),
    prisma.teamProfile.update({ where: { id: all[swapWith].id }, data: { orderIndex: all[idx].orderIndex } }),
  ]);
  await logActivity(session, {
    action: "profile.update",
    section: "people",
    entityType: "TeamProfile",
    entityId: id,
    summary: `Moved ${all[idx].fullName} ${direction} the org chart, swapping with ${all[swapWith].fullName}`,
    meta: { direction, swappedWith: all[swapWith].fullName },
  });
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
  const session = await requireAdmin(); // Admin sets OKRs (PRD2 §3.2)
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
  const owner = await prisma.teamProfile.findUnique({
    where: { id: d.teamProfileId },
    select: { fullName: true },
  });
  const who = owner?.fullName ?? "an unknown team member";
  if (id) {
    const before = await prisma.oKR.findUnique({ where: { id } });
    await prisma.oKR.update({ where: { id }, data });
    const diff = before
      ? diffFields<Record<string, unknown>>(before, data)
      : { changed: [], before: {}, after: {} };
    if (diff.changed.length) {
      await logActivity(session, {
        action: "okr.update",
        section: "people",
        entityType: "OKR",
        entityId: id,
        summary: `Updated ${who}'s OKR "${d.title}" — changed ${diff.changed.join(", ")}`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  } else {
    const okr = await prisma.oKR.create({ data });
    await logActivity(session, {
      action: "okr.create",
      section: "people",
      entityType: "OKR",
      entityId: okr.id,
      summary: `Set a new OKR for ${who} — "${d.title}", target ${d.targetValue}`,
      meta: { month: d.month, title: d.title, targetValue: d.targetValue },
    });
  }
  revalidatePath("/people");
  return { ok: true };
}

export async function deleteOkr(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const okr = await prisma.oKR.delete({
    where: { id },
    include: { teamProfile: { select: { fullName: true } } },
  });
  await logActivity(session, {
    action: "okr.delete",
    section: "people",
    entityType: "OKR",
    entityId: id,
    summary: `Removed ${okr.teamProfile.fullName}'s OKR "${okr.title}"`,
    meta: { title: okr.title, targetValue: okr.targetValue },
  });
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
  const data = { currentProgress: progress || null, currentNumeric: parseNumeric(progress) };
  await prisma.oKR.update({ where: { id }, data });
  const diff = diffFields<Record<string, unknown>>(okr, data);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "okr.update",
      section: "people",
      entityType: "OKR",
      entityId: id,
      summary: `Updated ${okr.teamProfile.fullName}'s progress on "${okr.title}" — now ${progress || "blank"}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
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

/**
 * Whole days between a log's date and today, both UTC-midnight @db.Date values.
 * 0 = today, 1 = yesterday. Negative would mean a future log, which cannot exist.
 */
function daysOld(logDate: Date, today: Date): number {
  return Math.round((today.getTime() - logDate.getTime()) / 86400000);
}

export async function submitDailyLog(form: FormData): Promise<ActionResult> {
  // Same guard as the /daily-log page (HEAD/USER + overrides) — requireSession
  // alone would let a STUDENT account write daily-log rows.
  const session = await requireSection("daily-log");
  const parsed = logSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const today = istToday(); // date auto-filled as today; future dates impossible (PRD2 §3.3)
  const eod = await getDailyLogEod();

  // Which fields the UI pre-filled from real activity — recorded so the timeline can badge
  // this entry as auto-captured later (today's auto-capture is recomputed live; history isn't).
  let autoKeys: string[] = [];
  try {
    const raw: unknown = JSON.parse(String(form.get("autoCapturedKeys") ?? "[]"));
    if (Array.isArray(raw)) {
      autoKeys = raw.filter((k): k is string => typeof k === "string" && LOG_NUMERIC_KEYS.has(k));
    }
  } catch {
    autoKeys = [];
  }

  const values = {
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
  };

  // ── Amend path: replacing an EOD_AUTO row with the real numbers ──
  // `logId` is only ever sent by the form when it is showing an auto-saved row. Every
  // condition is re-checked here from the DB — the id arrives from the client.
  const logId = String(form.get("logId") ?? "").trim();
  if (logId) {
    const existing = await prisma.dailyLog.findUnique({ where: { id: logId } });
    if (!existing || existing.userId !== session.user.id) {
      // Same message for "not found" and "not yours" — don't confirm other people's log ids.
      return { ok: false, error: "That log entry isn't yours to edit." };
    }
    if (existing.source !== "EOD_AUTO") {
      return { ok: false, error: "You have already submitted today. Contact Admin to make changes." };
    }
    if (!eod.enabled) {
      return { ok: false, error: "Amending auto-saved logs is switched off. Contact Admin to make changes." };
    }
    const age = daysOld(existing.date, today);
    if (age < 0 || age > eod.amendWindowDays) {
      return {
        ok: false,
        error:
          eod.amendWindowDays === 0
            ? "Auto-saved logs can't be amended. Contact Admin to make changes."
            : "The window to amend this auto-saved log has closed. Contact Admin to make changes.",
      };
    }
    await prisma.dailyLog.update({
      where: { id: existing.id },
      data: {
        ...values,
        // The member has now put their name to these numbers — it stops being a machine
        // guess, and re-locks under the normal one-shot rule.
        source: "HUMAN",
        autoCapturedKeys: autoKeys.length ? autoKeys : Prisma.DbNull,
      },
    });
    const diff = diffFields<Record<string, unknown>>(existing, values);
    await logActivity(session, {
      action: "dailylog.submit",
      section: "daily-log",
      entityType: "DailyLog",
      entityId: existing.id,
      summary: `Submitted their daily log for ${activityDate(existing.date)}, replacing the auto-saved numbers`,
      meta: { amended: true, changed: diff.changed, before: diff.before, after: diff.after, autoCapturedKeys: autoKeys },
    });
    revalidatePath("/daily-log");
    revalidatePath("/people");
    return { ok: true };
  }

  // ── Create path: a new log for today ──
  const existing = await prisma.dailyLog.findUnique({
    where: { userId_date: { userId: session.user.id, date: today } },
  });
  if (existing) {
    return { ok: false, error: "You have already submitted today. Contact Admin to make changes." };
  }

  // The EOD deadline. Only bites on a NEW log: an EOD_AUTO row is still amendable after the
  // cutoff (handled above), which is the whole point of auto-saving rather than blocking.
  if (eod.enabled && istMinutesOfDay(new Date()) >= eod.cutoffMinutes) {
    return {
      ok: false,
      error: `Today's ${formatIstMinutes(eod.cutoffMinutes)} cutoff has passed — today's log is closed. Contact Admin to make changes.`,
    };
  }

  try {
    const log = await prisma.dailyLog.create({
      data: {
        userId: session.user.id,
        date: today,
        ...values,
        autoCapturedKeys: autoKeys.length ? autoKeys : undefined,
      },
    });
    await logActivity(session, {
      action: "dailylog.submit",
      section: "daily-log",
      entityType: "DailyLog",
      entityId: log.id,
      summary: `Submitted their daily log for ${activityDate(today)}`,
      meta: { variant: d.variant, values, autoCapturedKeys: autoKeys },
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
  const session = await requireAdmin();
  const note = String(form.get("correctionNote") ?? "").trim();
  if (!note) return { ok: false, error: "Correction note cannot be empty" };
  const log = await prisma.dailyLog.update({
    where: { id: logId },
    data: { correctionNote: note },
    include: { user: { select: { name: true } } },
  });
  await logActivity(session, {
    action: "dailylog.correct",
    section: "daily-log",
    entityType: "DailyLog",
    entityId: logId,
    summary: `Added a correction note to ${log.user.name}'s log for ${activityDate(log.date)}`,
    meta: { note },
  });
  revalidatePath("/people");
  return { ok: true };
}
