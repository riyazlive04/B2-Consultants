"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { getWatiRuntime } from "@/lib/wati";
import { weeklyReportConfigSchema } from "@/lib/config-schema";
import { batchRosters } from "./batch-membership";
import { getWeeklyReportConfig, writeWeeklyReportConfig } from "./founder-config";
import { logActivity } from "./activity-log";
import { openCycleFor, sendWeeklyRung, weekLabelFor } from "./weekly-report-cycles";
import type { ActionResult } from "./finance-actions";

/**
 * THE WEEKLY REPORT - the staff writes.
 *
 * Four things a person can do here: record their verdict on a student's week, open a week by
 * hand, push the link out (or chase whoever has not answered), and withdraw a link that has
 * gone somewhere it should not have.
 *
 * ── The fence is re-checked, every time ───────────────────────────────────────────────
 * `mayActOn` below re-reads who may touch a cohort on every call, from the same rule
 * server/batch-access.ts states for attendance and the timetable: ADMIN, HEAD, anyone
 * holding `batches.manage`, or the cohort's own tutor. The dashboard already hides the
 * controls from everyone else, and that is not the fence - a hidden button never is.
 *
 * ── Why a review is an UPSERT on (cycle, student) ─────────────────────────────────────
 * The founders' sheet had one row per student per week and the delivery person edited it in
 * place, which is the right shape: "what did we decide about this student's week" has one
 * answer, and a correction replaces it rather than adding a second verdict. The history of
 * those corrections lives in the activity log, where it does not have to be reconciled with
 * anything.
 */

const flagEnum = z.enum(["GREEN", "YELLOW", "RED"]);
const actionEnum = z.enum(["NONE", "MESSAGE_SENT", "CALL_SCHEDULED", "ESCALATED"]);

const reviewSchema = z.object({
  cycleId: z.string().min(1),
  studentId: z.string().min(1),
  /**
   * Empty string means "accept the derived flag", which is NOT the same as GREEN. Storing
   * null keeps the engine's verdict live, so a later threshold change still applies to this
   * week; storing GREEN would freeze a decision the reviewer never actually made.
   */
  flag: z.union([flagEnum, z.literal("")]).optional(),
  action: actionEnum.default("NONE"),
  // Never z.coerce.boolean(): "false" from FormData parses as true. House rule, see
  // attendance-actions.ts. A two-value enum is the fix.
  followUpNeeded: z.enum(["yes", "no"]).default("no"),
  shareWithStudent: z.enum(["yes", "no"]).default("no"),
  note: z.string().trim().max(2000).optional(),
});

function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

/** Every screen that reads a weekly answer. Missing one is how a tutor chases a student twice. */
function revalidateWeekly(batchId?: string | null) {
  revalidatePath("/weekly-reports");
  revalidatePath("/coaching");
  revalidatePath("/my-journey");
  if (batchId) revalidatePath(`/batches/${batchId}`);
}

type Actor = Awaited<ReturnType<typeof requireSession>>;

/** The one authority on who may act on a cohort here - see the header. */
async function mayActOn(session: Actor, batchId: string): Promise<boolean> {
  if (session.role === "ADMIN" || session.role === "HEAD") return true;
  if (hasCapability(session.role as never, (session.capabilities ?? null) as never, "batches.manage")) {
    return true;
  }
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { tutorId: true } });
  return !!batch && batch.tutorId === session.user.id;
}

export async function saveWeeklyReview(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const cycle = await prisma.weeklyReportCycle.findUnique({
    where: { id: v.cycleId },
    select: {
      batchId: true, isoWeek: true, batchWeekNumber: true, weekStart: true, weekEnd: true,
      batch: { select: { name: true } },
    },
  });
  if (!cycle) return { ok: false, error: "That week no longer exists." };
  if (!(await mayActOn(session, cycle.batchId))) {
    return { ok: false, error: "You cannot review this cohort." };
  }

  const student = await prisma.student.findUnique({
    where: { id: v.studentId },
    select: { fullName: true },
  });
  if (!student) return { ok: false, error: "That student no longer exists." };

  const data = {
    flag: v.flag ? v.flag : null,
    action: v.action,
    followUpNeeded: v.followUpNeeded === "yes",
    shareWithStudent: v.shareWithStudent === "yes",
    note: v.note?.trim() ? v.note.trim() : null,
    reviewedById: session.user.id,
    reviewedAt: new Date(),
  };

  await prisma.weeklyReportReview.upsert({
    where: { cycleId_studentId: { cycleId: v.cycleId, studentId: v.studentId } },
    create: { cycleId: v.cycleId, studentId: v.studentId, ...data },
    update: data,
  });

  await logActivity(session, {
    action: "weekly.review.update",
    section: "weekly-reports",
    entityType: "WeeklyReportReview",
    entityId: `${v.cycleId}:${v.studentId}`,
    // Names, not ids - the log is read by people.
    summary: `Reviewed ${student.fullName}'s week ${cycle.isoWeek} (${cycle.batch.name})`,
    meta: {
      flag: data.flag,
      action: data.action,
      followUpNeeded: data.followUpNeeded,
      shareWithStudent: data.shareWithStudent,
    },
  });

  revalidateWeekly(cycle.batchId);
  return { ok: true };
}

const openSchema = z.object({ batchId: z.string().min(1) });

/**
 * Open this week by hand, for a cohort the cron has not reached - or has never been armed to
 * reach. This is the path that makes the feature usable while the engine is still off.
 */
export async function openWeeklyCycle(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const cohort = await prisma.batch.findUnique({
    where: { id: parsed.data.batchId },
    select: {
      id: true, name: true, code: true, line: true, level: true,
      startDate: true, status: true, weeklyTemplateId: true,
    },
  });
  if (!cohort) return { ok: false, error: "That cohort no longer exists." };
  if (cohort.status !== "ACTIVE") return { ok: false, error: "That cohort is archived." };
  if (!(await mayActOn(session, cohort.id))) {
    return { ok: false, error: "You cannot open a week for this cohort." };
  }

  const config = await getWeeklyReportConfig();
  const cycle = await openCycleFor(cohort, config, new Date(), session.user.id);
  if (!cycle) {
    return {
      ok: false,
      error: `No active question set for the ${cohort.line === "B2" ? "B2" : "German Note"} line. Add one in Console → Weekly reports.`,
    };
  }
  if (!cycle.created) return { ok: false, error: "This week is already open for this cohort." };

  await logActivity(session, {
    action: "weekly.cycle.open",
    section: "weekly-reports",
    entityType: "WeeklyReportCycle",
    entityId: cycle.id,
    summary: `Opened the weekly report for ${cohort.name}`,
  });

  revalidateWeekly(cohort.id);
  return { ok: true };
}

const sendSchema = z.object({
  cycleId: z.string().min(1),
  /** "all" sends the link to the whole roster; "pending" chases only those who have not answered. */
  audience: z.enum(["all", "pending"]),
});

/**
 * Send the link now, or chase whoever has not answered.
 *
 * Runs the same code the cron runs, with the viewer recorded as the sender - so a manual push
 * and an automatic one are de-duplicated against each other rather than doubling up. It also
 * honours `dryRun`: pressing this while the engine is rehearsing writes the SKIPPED rows and
 * says so, which is the only honest thing to do with a button that claims to have sent.
 */
export async function sendWeeklyReportLink(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const cycle = await prisma.weeklyReportCycle.findUnique({
    where: { id: parsed.data.cycleId },
    select: {
      id: true, batchId: true, batchWeekNumber: true, weekStart: true, weekEnd: true,
      isoWeek: true,
      batch: { select: { name: true, code: true } },
    },
  });
  if (!cycle) return { ok: false, error: "That week no longer exists." };
  if (!(await mayActOn(session, cycle.batchId))) {
    return { ok: false, error: "You cannot send for this cohort." };
  }
  const [config, runtime] = await Promise.all([getWeeklyReportConfig(), getWatiRuntime()]);
  const dryRun = config.dryRun || !runtime.enabled;

  let onlyStudentIds: Set<string> | null = null;
  if (parsed.data.audience === "pending") {
    const answered = await prisma.weeklyReportResponse.findMany({
      where: { cycleId: cycle.id },
      select: { studentId: true },
    });
    const seen = new Set(answered.map((a) => a.studentId));
    // Through the seam, never past it: a cohort's roster arrives from two tables and
    // server/batch-membership.ts is the one place that knows how to merge them.
    const seats = (await batchRosters([cycle.batchId])).get(cycle.batchId) ?? [];
    const ids = new Set(seats.map((s) => s.studentId).filter((id) => !seen.has(id)));
    if (ids.size === 0) return { ok: false, error: "Everyone on this cohort has already answered." };
    onlyStudentIds = ids;
  }

  const tally = await sendWeeklyRung({
    kind: parsed.data.audience === "pending" ? "WEEKLY_REPORT_REMINDER" : "WEEKLY_REPORT_LINK",
    cycle,
    cohortName: cycle.batch.code ?? cycle.batch.name,
    onlyStudentIds,
    runtime,
    dryRun,
    budget: config.maxPerRun,
    sentById: session.user.id,
  });

  if (parsed.data.audience === "all") {
    await prisma.weeklyReportCycle.update({
      where: { id: cycle.id },
      data: { sentAt: new Date() },
    });
  }

  await logActivity(session, {
    action: "weekly.cycle.send",
    section: "weekly-reports",
    entityType: "WeeklyReportCycle",
    entityId: cycle.id,
    summary: `Sent the ${weekLabelFor(cycle)} report link to ${cycle.batch.name}`,
    meta: { audience: parsed.data.audience, ...tally, dryRun },
  });

  revalidateWeekly(cycle.batchId);

  if (tally.sent === 0 && tally.skipped > 0) {
    return {
      ok: false,
      error: dryRun
        ? `Rehearsed ${tally.skipped} message(s) - nothing was really sent. Turn off the dry run in Console → Weekly reports.`
        : `Nothing went out: ${tally.skipped} message(s) were skipped. Check WhatsApp → Settings for a bound, approved template.`,
    };
  }
  return { ok: true };
}

const closeSchema = z.object({
  cycleId: z.string().min(1),
  state: z.enum(["OPEN", "CLOSED"]),
});

/**
 * Close a week early, or reopen one so a straggler can still answer.
 *
 * Reopening deliberately does NOT clear `late` on the submissions already in: when a report
 * arrived is a fact about the moment it arrived, and a deadline moved afterwards cannot make
 * a late answer punctual.
 */
export async function setWeeklyCycleState(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const cycle = await prisma.weeklyReportCycle.findUnique({
    where: { id: parsed.data.cycleId },
    select: { id: true, batchId: true, isoWeek: true, status: true, batch: { select: { name: true } } },
  });
  if (!cycle) return { ok: false, error: "That week no longer exists." };
  if (!(await mayActOn(session, cycle.batchId))) {
    return { ok: false, error: "You cannot change this cohort's week." };
  }
  if (cycle.status === parsed.data.state) return { ok: true };

  await prisma.weeklyReportCycle.update({
    where: { id: cycle.id },
    data:
      parsed.data.state === "CLOSED"
        ? { status: "CLOSED", closedAt: new Date() }
        : { status: "OPEN", closedAt: null },
  });

  await logActivity(session, {
    action: parsed.data.state === "CLOSED" ? "weekly.cycle.close" : "weekly.cycle.reopen",
    section: "weekly-reports",
    entityType: "WeeklyReportCycle",
    entityId: cycle.id,
    summary: `${parsed.data.state === "CLOSED" ? "Closed" : "Reopened"} ${cycle.isoWeek} for ${cycle.batch.name}`,
  });

  revalidateWeekly(cycle.batchId);
  return { ok: true };
}

/**
 * Save the cadence, the switches and the thresholds.
 *
 * ADMIN only, like every other Console panel: these numbers decide who the app calls a red
 * flag, and `enabled` decides whether it starts messaging students at all.
 */
export async function saveWeeklyReportConfig(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { ok: false, error: "Only the founder can change this." };

  const parsed = weeklyReportConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const before = await getWeeklyReportConfig();
  await writeWeeklyReportConfig(parsed.data);

  await logActivity(session, {
    action: "weekly.config.update",
    section: "console",
    entityType: "AppSetting",
    entityId: "weeklyReport",
    summary: `Updated the weekly report settings${
      before.enabled !== parsed.data.enabled ? (parsed.data.enabled ? " (engine ARMED)" : " (engine off)") : ""
    }`,
    meta: { before, after: parsed.data },
  });

  revalidateWeekly(null);
  revalidatePath("/console");
  return { ok: true };
}

// ── Which questions a cohort is asked ────────────────────────────────────────────────

const cohortTemplateSchema = z.object({
  batchId: z.string().min(1),
  /** Empty means "follow the line and level default" - not "ask nothing". */
  templateId: z.string().optional(),
});

/**
 * Point one cohort at its own question set.
 *
 * Cohorts are not interchangeable: two running on the same level can be doing different
 * activities, and before this the only lever was the level, which a founder cannot vary per
 * cohort. Clearing it falls back to the line/level default rather than muting the cohort.
 *
 * Only affects weeks opened FROM NOW ON. A cycle pins the template it was opened with, so
 * answers already given still read against the questions that were actually asked - the same
 * reason editing a live question mints a new version rather than rewriting the old one.
 */
export async function setCohortWeeklyTemplate(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = cohortTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const batch = await prisma.batch.findUnique({
    where: { id: parsed.data.batchId },
    select: { id: true, name: true, line: true },
  });
  if (!batch) return { ok: false, error: "That cohort no longer exists." };
  if (!(await mayActOn(session, batch.id))) {
    return { ok: false, error: "You cannot change this cohort's question set." };
  }

  const templateId = parsed.data.templateId?.trim() || null;
  let templateName = "the default for its line";
  if (templateId) {
    const template = await prisma.weeklyReportTemplate.findFirst({
      where: { id: templateId, active: true },
      select: { id: true, name: true, line: true },
    });
    if (!template) return { ok: false, error: "That question set is not available." };
    // A B2 cohort asked the German Note questions would be asked about study hours and never
    // about applications, and the flag engine would then have nothing to judge.
    if (template.line !== batch.line) {
      return { ok: false, error: "That question set belongs to the other business line." };
    }
    templateName = template.name;
  }

  await prisma.batch.update({
    where: { id: batch.id },
    data: { weeklyTemplateId: templateId },
  });

  await logActivity(session, {
    action: "weekly.cohort.template",
    section: "weekly-reports",
    entityType: "Batch",
    entityId: batch.id,
    summary: `${batch.name} will be asked ${templateName}`,
    meta: { templateId },
  });

  revalidateWeekly(batch.id);
  return { ok: true };
}
