import "server-only";
import type { WhatsAppKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWatiRuntime } from "@/lib/wati";
import { publicOrigin } from "@/lib/public-seo";
import { formatDate } from "@/lib/format";
import { istDayOf, istMinutesOfDay, istWeekRange, toDateInputValue } from "@/lib/dates";
import { batchWeekNumber, weekRefFor } from "@/lib/weekly-form";
import type { WeeklyReportConfig } from "@/lib/config-schema";
import { sendWhatsApp, type SendOutcome } from "./whatsapp";
import { batchRosters } from "./batch-membership";
import { getWeeklyReportConfig } from "./founder-config";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * THE WEEKLY REPORT ENGINE - open the week, send the link, chase the silence, close it.
 *
 * This is the Monday routine from the founders' "How To Use" tab, which currently reads:
 * "Go through every Phase 2 student -> did they submit? Log in Sprint Tracker -> update
 * Student Master 'Last Form Date' and 'Weekly Form Streak'". Everything after the question
 * mark is derived elsewhere; this file is what asks the question.
 *
 * ── Idempotence, which is the whole problem ───────────────────────────────────────────
 * Like the class reminders beside it, this fans out to a ROOM. A duplicate tick would hand a
 * cohort two links for the same week and split its answers across two rows, so "have we
 * already done this" is answered from durable state, never from memory:
 *   the CYCLE itself       - `@@unique([batchId, isoWeek])` makes a second open impossible.
 *   `WhatsAppMessage` rows - carrying `weeklyCycleId`, exactly as the class reminders carry
 *                            `classSessionId`. The rows that were sent ARE the record of what
 *                            was sent, and they are the same rows the WhatsApp screen shows.
 * A separate sent-log table would have been a second record of the same fact, free to
 * disagree with the first.
 *
 * ── Why it ships off, and rehearses when armed ────────────────────────────────────────
 * `enabled` false, `dryRun` true. The first thing this engine does when armed is message
 * every student in every active cohort, the WATI templates it needs are not approved yet,
 * and the live account has no test recipient set - so a mistake here reaches real phones. A
 * dry run writes the full SKIPPED row, recipient and resolved text included, so the exact
 * blast can be read before one real message leaves.
 */

export type WeeklyRun = {
  enabled: boolean;
  reason?: string;
  ranAt: string;
  opened: number;
  closed: number;
  /** The delivery tally the cron route harvests - see collectDelivery in cron-route.ts. */
  delivery: { sent: number; skipped: number; failed: number };
  dryRun: boolean;
};

const empty = (over: Partial<WeeklyRun>): WeeklyRun => ({
  enabled: false,
  ranAt: new Date().toISOString(),
  opened: 0,
  closed: 0,
  delivery: { sent: 0, skipped: 0, failed: 0 },
  dryRun: true,
  ...over,
});

/** First name only - "Hi Priya Raman," reads like a letter from a bank. */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full.trim();
}

/** ISO weekday, 1 = Monday, from a UTC-midnight IST date. */
function isoWeekday(d: Date): number {
  return ((d.getUTCDay() + 6) % 7) + 1;
}

/**
 * The instant an IST weekday-and-minute falls on, inside the week `weekStart` begins.
 *
 * Built from the week's Monday rather than from "today" so that opensAt and closesAt are
 * properties of the WEEK. Deriving them from the current time would move the deadline every
 * time the cron ticked, and `late` is recorded against that deadline.
 */
function instantInWeek(weekStart: Date, isoDay: number, minutes: number): Date {
  const day = new Date(weekStart);
  day.setUTCDate(weekStart.getUTCDate() + (isoDay - 1));
  // 00:00 IST is 18:30 UTC the previous day; add the wall-clock minutes to that.
  return new Date(day.getTime() - 5.5 * 3600_000 + minutes * 60_000);
}

export type WeeklyWindow = { isoWeek: string; weekStart: Date; weekEnd: Date; opensAt: Date; closesAt: Date };

/** The window for the ISO week containing `ref`, per the founder's configured cadence. */
export function windowFor(config: WeeklyReportConfig, ref: Date): WeeklyWindow {
  // `ref` is usually `new Date()`. Normalised to its IST calendar day before any week
  // arithmetic, because `istWeekRange` preserves the time it is handed - see `istDayOf`.
  const day = istDayOf(ref);
  const { start } = istWeekRange(day);
  const refs = weekRefFor(day);
  const weekEnd = new Date(start);
  weekEnd.setUTCDate(start.getUTCDate() + 6);

  const opensAt = instantInWeek(start, config.openWeekday, config.openAtMinutes);
  let closesAt = instantInWeek(start, config.closeWeekday, config.closeAtMinutes);
  // A close configured earlier in the week than the open would give a window of negative
  // length, and every submission in it would be late. Roll it to the following week instead
  // of refusing: the founder meant "Tuesday", and Tuesday after Friday is next Tuesday.
  if (closesAt.getTime() <= opensAt.getTime()) {
    closesAt = new Date(closesAt.getTime() + 7 * 86400_000);
  }

  return { isoWeek: refs.isoWeek, weekStart: start, weekEnd, opensAt, closesAt };
}

type CohortForOpen = {
  id: string;
  name: string;
  code: string | null;
  line: string;
  level: string;
  startDate: Date | null;
  /** The cohort's own question set, when somebody has chosen one for it. */
  weeklyTemplateId?: string | null;
};

/**
 * The question set a cohort is asked, most specific first.
 *
 *   1. the cohort's OWN choice (`Batch.weeklyTemplateId`) - two cohorts on the same level can
 *      be running different activities, and this is the only lever that can say so;
 *   2. a template pinned to the cohort's level, which is how Elite is asked something Guided
 *      is not;
 *   3. the line's general template.
 *
 * A cohort whose line has no active template at all is SKIPPED rather than asked the other
 * line's questions - a German Note class has no applications to report, and a column of
 * zeroes would be read by the flag engine as failure rather than as a question nobody asked.
 */
export async function templateFor(cohort: CohortForOpen): Promise<string | null> {
  if (cohort.weeklyTemplateId) {
    const chosen = await prisma.weeklyReportTemplate.findFirst({
      where: { id: cohort.weeklyTemplateId, active: true },
      select: { id: true },
    });
    // A chosen-but-deactivated template falls through rather than stopping the cohort being
    // asked anything: the founder switched a question set off, they did not mute a cohort.
    if (chosen) return chosen.id;
  }
  const rows = await prisma.weeklyReportTemplate.findMany({
    where: { active: true, line: cohort.line as never },
    select: { id: true, levelCode: true },
  });
  return (
    rows.find((t) => t.levelCode === cohort.level)?.id ??
    rows.find((t) => t.levelCode === null)?.id ??
    null
  );
}

/**
 * Open this week's cycle for one cohort, or return the one that already exists.
 *
 * `openedById` null means the cron did it. The unique constraint is what makes this safe to
 * call from both the cron and a founder's button at the same moment.
 */
export async function openCycleFor(
  cohort: CohortForOpen,
  config: WeeklyReportConfig,
  ref: Date,
  openedById: string | null,
): Promise<{ id: string; created: boolean } | null> {
  const win = windowFor(config, ref);
  const existing = await prisma.weeklyReportCycle.findUnique({
    where: { batchId_isoWeek: { batchId: cohort.id, isoWeek: win.isoWeek } },
    select: { id: true },
  });
  if (existing) return { ...existing, created: false };

  const templateId = await templateFor(cohort);
  if (!templateId) return null;

  const created = await prisma.weeklyReportCycle.create({
    data: {
      batchId: cohort.id,
      templateId,
      isoWeek: win.isoWeek,
      weekStart: win.weekStart,
      weekEnd: win.weekEnd,
      batchWeekNumber: batchWeekNumber(cohort.startDate, win.weekStart),
      opensAt: win.opensAt,
      closesAt: win.closesAt,
      openedById,
    },
    select: { id: true },
  });
  return { ...created, created: true };
}

/**
 * Where a student is sent to answer: their own dashboard, behind their own login.
 *
 * There is no public form and no per-cohort link. The session is the identity check, which
 * is a stronger one than a shared link plus a typed Student ID ever was, and it means a
 * message that leaks out of a cohort's group chat lets nobody answer as anybody.
 *
 * Null when the deployment cannot know its own origin - the send layer then skips rather
 * than messaging a relative path nobody can tap.
 */
export function weeklyReportUrl(): string | null {
  const origin = publicOrigin();
  return origin ? `${origin}/my-journey` : null;
}

/** "Week 4, 26/10 - 01/11" - what a student recognises. The ISO key is for the database. */
export function weekLabelFor(cycle: { batchWeekNumber: number | null; weekStart: Date; weekEnd: Date }): string {
  const range = `${formatDate(cycle.weekStart)} - ${formatDate(cycle.weekEnd)}`;
  return cycle.batchWeekNumber !== null ? `Week ${cycle.batchWeekNumber}, ${range}` : range;
}

type SendTally = { sent: number; skipped: number; failed: number };

/**
 * Send one weekly-report rung to the students who have not already had it.
 *
 * Returns how many were sent so the caller can keep one budget across every cohort and every
 * rung. `alreadySent` is read from `WhatsAppMessage` once per cycle, not once per student: a
 * cohort of thirty would otherwise cost thirty queries per tick.
 */
export async function sendWeeklyRung(args: {
  kind: Extract<
    WhatsAppKind,
    "WEEKLY_REPORT_LINK" | "WEEKLY_REPORT_REMINDER" | "WEEKLY_REPORT_MISSING"
  >;
  cycle: { id: string; batchId: string; batchWeekNumber: number | null; weekStart: Date; weekEnd: Date };
  cohortName: string;
  /** Null sends to the whole roster; a set sends only to those students. */
  onlyStudentIds: Set<string> | null;
  runtime: Awaited<ReturnType<typeof getWatiRuntime>>;
  dryRun: boolean;
  budget: number;
  sentById?: string | null;
}): Promise<SendTally & { spent: number }> {
  const tally: SendTally & { spent: number } = { sent: 0, skipped: 0, failed: 0, spent: 0 };
  if (args.budget <= 0) return tally;

  const url = weeklyReportUrl();
  // No origin means no link, and a weekly-report message without its link is just noise. The
  // send layer would refuse it anyway (a missing variable blocks delivery rather than sending
  // "fill it in here: "), but failing here keeps a SKIPPED row per student off the log.
  if (!url) return tally;

  const seats = (await batchRosters([args.cycle.batchId])).get(args.cycle.batchId) ?? [];
  const targets = args.onlyStudentIds
    ? seats.filter((s) => args.onlyStudentIds!.has(s.studentId))
    : seats;
  if (targets.length === 0) return tally;

  const prior = await prisma.whatsAppMessage.findMany({
    where: {
      weeklyCycleId: args.cycle.id,
      kind: args.kind,
      direction: "OUTBOUND",
      studentId: { in: targets.map((t) => t.studentId) },
    },
    select: { studentId: true },
  });
  const had = new Set(prior.map((p) => p.studentId).filter((id): id is string => !!id));

  const phones = await prisma.student.findMany({
    where: { id: { in: targets.map((t) => t.studentId) } },
    select: { id: true, phone: true, fullName: true },
  });
  const byId = new Map(phones.map((p) => [p.id, p]));

  const week = weekLabelFor(args.cycle);
  let budget = args.budget;

  for (const seat of targets) {
    if (budget <= 0) break;
    if (had.has(seat.studentId)) continue;
    const student = byId.get(seat.studentId);
    if (!student) continue;

    const out: SendOutcome = await sendWhatsApp({
      kind: args.kind,
      to: student.phone,
      studentId: seat.studentId,
      weeklyCycleId: args.cycle.id,
      runtime: args.runtime,
      dryRun: args.dryRun,
      sentById: args.sentById ?? null,
      vars: {
        name: firstName(student.fullName),
        cohort: args.cohortName,
        week,
        report_url: url,
      },
    });

    if (out.sent) {
      tally.sent += 1;
      budget -= 1;
      tally.spent += 1;
    } else if (out.status === "FAILED") {
      tally.failed += 1;
      budget -= 1;
      tally.spent += 1;
    } else {
      tally.skipped += 1;
    }
  }

  return tally;
}

/** Students on this cohort who have not submitted for this cycle. */
async function nonResponders(cycleId: string, batchId: string): Promise<Set<string>> {
  const [seats, responses] = await Promise.all([
    batchRosters([batchId]),
    prisma.weeklyReportResponse.findMany({ where: { cycleId }, select: { studentId: true } }),
  ]);
  const answered = new Set(responses.map((r) => r.studentId));
  return new Set(
    (seats.get(batchId) ?? []).map((s) => s.studentId).filter((id) => !answered.has(id)),
  );
}

/**
 * One tick. Opens what is due, sends what is unsent, closes what has run out of time.
 *
 * Order matters: closing happens LAST, so a cycle that closes on this tick has already had
 * its chance to be reminded on an earlier one, and the missed-notice is sent from the closing
 * branch rather than racing the reminder.
 */
export async function runWeeklyReports(): Promise<WeeklyRun> {
  const ranAt = new Date().toISOString();
  const config = await getWeeklyReportConfig();

  if (!config.enabled) {
    return empty({ ranAt, reason: "The weekly report engine is off in Console → Weekly reports" });
  }

  const runtime = await getWatiRuntime();
  const dryRun = config.dryRun || !runtime.enabled;
  const now = new Date();
  const delivery: SendTally = { sent: 0, skipped: 0, failed: 0 };
  let budget = Math.max(0, config.maxPerRun);
  let opened = 0;
  let closed = 0;

  const add = (t: SendTally & { spent: number }) => {
    delivery.sent += t.sent;
    delivery.skipped += t.skipped;
    delivery.failed += t.failed;
    budget -= t.spent;
  };

  // ── 1. Open this week's cycles ─────────────────────────────────────────────────────
  const win = windowFor(config, now);
  if (now.getTime() >= win.opensAt.getTime()) {
    const cohorts = await prisma.batch.findMany({
      where: {
        status: "ACTIVE",
        ...(config.germanNoteEnabled ? {} : { line: "B2" }),
      },
      select: {
        id: true, name: true, code: true, line: true, level: true,
        startDate: true, weeklyTemplateId: true,
      },
      take: 200,
    });

    for (const cohort of cohorts) {
      const cycle = await openCycleFor(cohort, config, now, null);
      if (!cycle) continue;
      if (cycle.created) opened += 1;
    }
  }

  // ── 2. Send the link for any open cycle that has not had it ────────────────────────
  const openCycles = await prisma.weeklyReportCycle.findMany({
    where: { status: "OPEN" },
    select: {
      id: true, batchId: true, isoWeek: true, weekStart: true, weekEnd: true,
      batchWeekNumber: true, opensAt: true, closesAt: true, sentAt: true,
      batch: { select: { name: true, code: true } },
    },
    orderBy: { weekStart: "asc" },
    take: 200,
  });

  for (const cycle of openCycles) {
    if (budget <= 0) break;
    if (now.getTime() < cycle.opensAt.getTime()) continue;

    const cohortName = cycle.batch.code ?? cycle.batch.name;

    if (!cycle.sentAt) {
      const tally = await sendWeeklyRung({
        kind: "WEEKLY_REPORT_LINK",
        cycle,
        cohortName,
        onlyStudentIds: null,
        runtime,
        dryRun,
        budget,
      });
      add(tally);
      // Marked sent even on a dry run: the rehearsal has produced its SKIPPED rows and
      // repeating it every minute would bury the log in them. Arming the engine then sends
      // the real link, because the per-student guard reads rows of THIS kind that really went.
      if (tally.sent + tally.skipped + tally.failed > 0) {
        await prisma.weeklyReportCycle.update({
          where: { id: cycle.id },
          data: { sentAt: new Date() },
        });
      }
      continue;
    }

    // ── 3. Remind whoever has not answered ───────────────────────────────────────────
    if (!config.reminderEnabled || budget <= 0) continue;
    const remindAt = instantInWeek(cycle.weekStart, config.reminderWeekday, config.reminderAtMinutes);
    if (now.getTime() < remindAt.getTime() || now.getTime() > cycle.closesAt.getTime()) continue;

    const pending = await nonResponders(cycle.id, cycle.batchId);
    if (pending.size === 0) continue;
    add(
      await sendWeeklyRung({
        kind: "WEEKLY_REPORT_REMINDER",
        cycle,
        cohortName,
        onlyStudentIds: pending,
        runtime,
        dryRun,
        budget,
      }),
    );
  }

  // ── 4. Close what has run out of time, and chase the silence once ──────────────────
  const dueToClose = await prisma.weeklyReportCycle.findMany({
    where: { status: "OPEN", closesAt: { lt: now } },
    select: {
      id: true, batchId: true, weekStart: true, weekEnd: true, batchWeekNumber: true,
      batch: { select: { name: true, code: true } },
    },
    orderBy: { closesAt: "asc" },
    take: 100,
  });

  for (const cycle of dueToClose) {
    if (config.missedNoticeEnabled && budget > 0) {
      const pending = await nonResponders(cycle.id, cycle.batchId);
      if (pending.size > 0) {
        add(
          await sendWeeklyRung({
            kind: "WEEKLY_REPORT_MISSING",
            cycle,
            cohortName: cycle.batch.code ?? cycle.batch.name,
            onlyStudentIds: pending,
            runtime,
            dryRun,
            budget,
          }),
        );
      }
    }

    await prisma.weeklyReportCycle.update({
      where: { id: cycle.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    closed += 1;
  }

  if (opened > 0 || closed > 0) {
    await logSystemActivity(SYSTEM_ACTORS.weeklyReport, {
      action: "weekly.cycle.run",
      section: "weekly-reports",
      entityType: "WeeklyReportCycle",
      entityId: win.isoWeek,
      summary: `Weekly report ${win.isoWeek}: opened ${opened}, closed ${closed}`,
      meta: { opened, closed, delivery, dryRun },
    });
  }

  return {
    enabled: true,
    ranAt,
    opened,
    closed,
    delivery,
    dryRun,
  };
}

/** Unused today, kept so a reader can see the cadence is readable as well as writable. */
export function nextOpenDescription(config: WeeklyReportConfig, ref: Date): string {
  const win = windowFor(config, ref);
  return `${toDateInputValue(win.weekStart)} · opens ${formatDate(win.opensAt)}, closes ${formatDate(win.closesAt)}`;
}

/** Exported for the Console panel's preview line. */
export function cadenceSummary(config: WeeklyReportConfig): string {
  const day = (n: number) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][n - 1] ?? "?";
  const time = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `Opens ${day(config.openWeekday)} ${time(config.openAtMinutes)}, closes ${day(config.closeWeekday)} ${time(config.closeAtMinutes)} IST`;
}

/** Re-exported so the Console panel can render the current minute-of-day without duplicating it. */
export { istMinutesOfDay, isoWeekday };
