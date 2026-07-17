import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istMinutesOfDay, istToday } from "@/lib/dates";
import { formatIstMinutes } from "@/lib/config-schema";
import { getDailyLogEod } from "./founder-config";
import { computeAutoCapture } from "./daily-log-capture";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * The EOD job behind "every telecaller's log is saved by the end of the day".
 *
 * THE APP HAS NO CLOCK. Nothing in here wakes itself up — /api/cron/daily-log is the seam, and
 * Windows Task Scheduler (scripts/install-daily-log-task.ps1) is what actually ticks it. If that
 * task isn't running, auto-save never fires and the feature is inert. The cutoff itself is NOT
 * dependent on the cron: submitDailyLog reads the real clock, so the deadline holds regardless.
 *
 * Idempotent by construction: it only writes for a member with no row for today, and
 * (userId, date) is unique — so a re-tick, an overlapping tick, or a member submitting in the
 * same second all converge on "exactly one row per person per day".
 */

export type EodMemberResult = {
  name: string;
  /** The keys auto-capture could actually derive. Empty = we knew nothing about their day. */
  captured: string[];
};

export type EodRun = {
  enabled: boolean;
  /** Why nothing happened, when nothing happened. */
  reason?: string;
  /** The IST day this run is about (YYYY-MM-DD). */
  date: string;
  /** Rows written by this tick. */
  autoSaved: number;
  /** Members who had already logged — the healthy case. */
  alreadyLogged: number;
  autoSavedMembers: EodMemberResult[];
};

const empty = (date: string, enabled: boolean, reason: string): EodRun => ({
  enabled,
  reason,
  date,
  autoSaved: 0,
  alreadyLogged: 0,
  autoSavedMembers: [],
});

/**
 * Everyone who owes a log today. Mirrors `logsDaily` in people-metrics.ts exactly — ACTIVE,
 * non-Admin, and actually attached to a login. Admin (Ameen) has no daily-log duty, so
 * auto-saving a row for him would invent an obligation the PRD never gave him.
 */
async function membersWhoOweALog() {
  const profiles = await prisma.teamProfile.findMany({
    where: { status: "ACTIVE", dashboardRole: { not: "ADMIN" }, userId: { not: null } },
    select: { userId: true, fullName: true, logVariant: true },
    orderBy: { orderIndex: "asc" },
  });
  return profiles.filter((p): p is typeof p & { userId: string } => p.userId !== null);
}

/**
 * Write an EOD_AUTO log for anyone who didn't submit today. Called by the cron route.
 *
 * Deliberately does NOT coerce missing fields to 0: auto-capture can't see
 * followUpMessagesSent / studentsCheckedInOn / assignmentsReviewed at all, and writing 0 would
 * turn "nobody reported this" into "they did none of it" on the pay board. Those stay NULL and
 * the member fills them in via the amend window.
 */
export async function runDailyLogEod(): Promise<EodRun> {
  const today = istToday();
  const dateStr = today.toISOString().slice(0, 10);
  const cfg = await getDailyLogEod();

  if (!cfg.enabled) return empty(dateStr, false, "Daily-log EOD rules are switched off");
  if (!cfg.autoSave) return empty(dateStr, true, "Auto-save is switched off");

  const nowMinutes = istMinutesOfDay(new Date());
  if (nowMinutes < cfg.cutoffMinutes) {
    return empty(dateStr, true, `Before today's ${formatIstMinutes(cfg.cutoffMinutes)} cutoff — nothing to do yet`);
  }

  const [members, todayLogs] = await Promise.all([
    membersWhoOweALog(),
    prisma.dailyLog.findMany({ where: { date: today }, select: { userId: true } }),
  ]);
  const logged = new Set(todayLogs.map((l) => l.userId));

  const run: EodRun = { enabled: true, date: dateStr, autoSaved: 0, alreadyLogged: 0, autoSavedMembers: [] };

  for (const m of members) {
    if (logged.has(m.userId)) {
      run.alreadyLogged++;
      continue;
    }
    const captured = await computeAutoCapture(m.userId, m.logVariant, today);
    const capturedKeys = Object.keys(captured);
    try {
      const created = await prisma.dailyLog.create({
        data: {
          userId: m.userId,
          date: today,
          variant: m.logVariant,
          ...captured,
          source: "EOD_AUTO",
          // Every number in this row came from activity, by definition — there was no human
          // to type one. The timeline badges each of these as auto-captured.
          autoCapturedKeys: capturedKeys.length ? capturedKeys : undefined,
        },
      });
      run.autoSaved++;
      run.autoSavedMembers.push({ name: m.fullName, captured: capturedKeys });
      // Logged per row, not per run: a day closed in someone's name without them typing a
      // thing is exactly the kind of thing the founder should be able to see and question.
      await logSystemActivity(SYSTEM_ACTORS.dailyLog, {
        action: "dailylog.autosave",
        section: "daily-log",
        entityType: "DailyLog",
        entityId: created.id,
        summary: `Auto-saved ${m.fullName}'s daily log for ${dateStr} — nothing submitted by the ${formatIstMinutes(cfg.cutoffMinutes)} cutoff`,
        meta: { date: dateStr, variant: m.logVariant, capturedCount: capturedKeys.length },
      });
    } catch (e) {
      // They submitted between our read and our write — their row wins, always. A human
      // submission is the record; this job only ever fills a vacuum.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        run.alreadyLogged++;
        continue;
      }
      throw e;
    }
  }

  return run;
}

export type EodStatus = {
  /** Past the cutoff for today? */
  pastCutoff: boolean;
  /** Past the nudge time but not yet the cutoff — the window where a reminder makes sense. */
  inNudgeWindow: boolean;
  cutoffLabel: string;
  minutesToCutoff: number;
};

/** Where "now" sits against today's EOD timeline. Pure clock maths — no I/O beyond the config. */
export async function getEodStatus(): Promise<EodStatus & { enabled: boolean }> {
  const cfg = await getDailyLogEod();
  const now = istMinutesOfDay(new Date());
  return {
    enabled: cfg.enabled,
    pastCutoff: now >= cfg.cutoffMinutes,
    inNudgeWindow: now >= cfg.nudgeMinutes && now < cfg.cutoffMinutes,
    cutoffLabel: formatIstMinutes(cfg.cutoffMinutes),
    minutesToCutoff: cfg.cutoffMinutes - now,
  };
}
