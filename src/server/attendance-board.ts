import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { hasCapability, type CapabilityOverrides } from "@/lib/capabilities";
import type { AppRole } from "@/lib/sections";
import { toDateInputValue, istToday } from "@/lib/dates";
import { isAttended, isCounted, type AttendanceStatus } from "@/lib/attendance";
import { remainingMs, windowState, type WindowState } from "@/lib/attendance-window";
import { getAttendanceConfig } from "./founder-config";
import { getCatchUpRows, type CatchUpRow } from "./catch-up";

/**
 * THE REGISTER DESK - one screen for taking attendance, across every cohort you teach.
 *
 * ── Why a section of its own, when the sheet already existed ────────────────────────────
 * Taking the register was reachable from two places, both of which are somewhere else you
 * were going: a tab on `/batches/[id]` and a row on the German Note schedule. That is fine
 * for a correction a week later and wrong for the thing this is actually for, which happens
 * at a fixed moment - the first two minutes of a class - while the tutor is also sharing a
 * screen and greeting eight people. At that moment nobody navigates a cohort page to find a
 * tab. They want one door that already knows which class is now.
 *
 * So this read answers exactly three questions, in the order a tutor has them:
 *   1. What is open right now, and who has arrived? (`liveNow`)
 *   2. What am I teaching today? (`today`)
 *   3. What did I never mark, and what have I not shown the students yet? (`outstanding`,
 *      `unpublished`)
 *
 * ── Scope ───────────────────────────────────────────────────────────────────────────────
 * `Batch.tutorId` for the person who leads it; every active cohort for a supervisor (ADMIN,
 * HEAD, or anyone holding `batches.manage`). `canMark` is computed PER SESSION rather than
 * once for the page, because a supervisor's board mixes cohorts they may act on with cohorts
 * they may only read, and a button whose only outcome is an error message is worse than none.
 *
 * PRE_RECORDED modules are excluded throughout. A video released on a Monday has no room to
 * be in and no register to take - see `SessionDelivery`.
 */

export type BoardSessionView = {
  id: string;
  batchId: string;
  batchName: string;
  batchLine: "B2" | "GERMAN_NOTE";
  title: string;
  framework: string | null;
  dateYmd: string;
  timeHm: string | null;
  startsAt: string;
  durationMins: number | null;
  joinUrl: string | null;
  isPast: boolean;

  rosterSize: number;
  markedCount: number;
  /** Of those marks, how many the students made themselves. */
  checkedInCount: number;
  attendedCount: number;

  windowState: WindowState;
  windowClosesAt: string | null;
  /** Milliseconds left when this was read; the client ticks down from it. */
  windowRemainingMs: number;
  openedByName: string | null;

  publishedAt: string | null;
  publishedByName: string | null;

  /** May THIS viewer open, mark and publish this one? */
  canMark: boolean;
};

export type BoardBatchView = {
  id: string;
  name: string;
  code: string | null;
  line: "B2" | "GERMAN_NOTE";
  level: string;
  rosterSize: number;
  liveSessions: number;
  markedSessions: number;
  /** Attended / counted across the whole cohort, as a percentage. Null if nothing is marked. */
  attendancePct: number | null;
  iLead: boolean;
  href: string;
};

export type AttendanceBoard = {
  role: AppRole;
  /** False when the founder has switched self check-in off - the board hides every open button. */
  selfCheckInEnabled: boolean;
  defaultWindowMins: number;
  defaultGraceMins: number;
  publishRequired: boolean;
  /** Hours after a recording goes up before not watching it counts as late. */
  catchUpHours: number;
  /** True when this person leads nothing and is looking at other people's cohorts. */
  supervising: boolean;
  /**
   * Students who missed a class and have not caught up on the recording.
   *
   * Scoped to the cohorts this viewer may MARK, not merely view. A supervisor reading somebody
   * else's cohort can see the register; a chase-list is a list of people to contact, and
   * handing it to someone with no standing to contact them is how two people chase the same
   * student on the same day.
   */
  catchUp: CatchUpRow[];
  liveNow: BoardSessionView[];
  today: BoardSessionView[];
  outstanding: BoardSessionView[];
  unpublished: BoardSessionView[];
  recent: BoardSessionView[];
  batches: BoardBatchView[];
};

function istParts(d: Date): { dateYmd: string; timeHm: string } {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return { dateYmd: ist.toISOString().slice(0, 10), timeHm: ist.toISOString().slice(11, 16) };
}

/**
 * How far back the board looks.
 *
 * Six weeks, which is longer than a B2 cohort's four teaching weeks and comfortably covers a
 * German Note tutor who has let a month slide. Past that, an unmarked register is history
 * rather than a chore - and it is still reachable from the cohort's own page, which is where
 * a correction to something that old belongs.
 */
const LOOKBACK_DAYS = 42;

export const getAttendanceBoard = cache(
  async (session: {
    role: AppRole;
    user: { id: string };
    capabilities: CapabilityOverrides | null;
  }): Promise<AttendanceBoard> => {
    const userId = session.user.id;
    const config = await getAttendanceConfig();

    /**
     * HEAD IS IN HERE DELIBERATELY, and it is the one place this feature widens a permission.
     *
     * Everywhere else a Head coach is a reader on somebody else's cohort (`canViewBatch` in
     * batch-detail.ts returns `manage: false` for them). The register is the exception because
     * the founders asked for it in those words - the head coach enables attendance - and
     * because a Head coach does stand in front of these cohorts. `canMark` in
     * attendance-actions.ts is the enforcing copy of this rule; the two must agree.
     */
    const supervisor =
      session.role === "ADMIN" ||
      session.role === "HEAD" ||
      hasCapability(session.role, session.capabilities, "batches.manage");

    const led = await prisma.batch.findMany({
      where: { tutorId: userId, status: "ACTIVE" },
      select: { id: true },
    });
    const supervising = supervisor && led.length === 0;

    const batches = await prisma.batch.findMany({
      where: supervisor ? { status: "ACTIVE" } : { status: "ACTIVE", tutorId: userId },
      select: {
        id: true, line: true, name: true, code: true, level: true, tutorId: true,
        _count: { select: { members: true, enrollments: true } },
        events: {
          where: {
            delivery: "LIVE",
            startsAt: { gte: new Date(Date.now() - LOOKBACK_DAYS * 86_400_000) },
          },
          orderBy: { startsAt: "asc" },
          select: {
            id: true, title: true, framework: true, startsAt: true, durationMins: true,
            joinUrl: true,
            attendanceOpensAt: true, attendanceClosesAt: true,
            attendancePublishedAt: true,
            attendanceOpenedBy: { select: { name: true, email: true } },
            attendancePublishedBy: { select: { name: true, email: true } },
            attendance: { select: { status: true, source: true } },
          },
        },
      },
      orderBy: [{ startDate: "desc" }, { name: "asc" }],
    });

    const now = new Date();
    const nowMs = now.getTime();
    const todayYmd = toDateInputValue(istToday());

    const liveNow: BoardSessionView[] = [];
    const today: BoardSessionView[] = [];
    const outstanding: BoardSessionView[] = [];
    const unpublished: BoardSessionView[] = [];
    const recent: BoardSessionView[] = [];
    const batchViews: BoardBatchView[] = [];

    for (const b of batches) {
      const rosterSize = b._count.members + b._count.enrollments;
      // `supervisor` above IS the "may mark anything" predicate; written once so the two
      // cannot drift, which is how a board grows a button its action refuses.
      const canMark = supervisor || b.tutorId === userId;

      let markedSessions = 0;
      let attendedTotal = 0;
      let countedTotal = 0;

      for (const e of b.events) {
        const { dateYmd, timeHm } = istParts(e.startsAt);
        const start = e.startsAt.getTime();
        const end = start + (e.durationMins ?? 90) * 60_000;
        const w = { opensAt: e.attendanceOpensAt, closesAt: e.attendanceClosesAt };
        const state = windowState(w, now);

        for (const a of e.attendance) {
          const status = a.status as AttendanceStatus;
          if (!isCounted(status)) continue;
          countedTotal += 1;
          if (isAttended(status)) attendedTotal += 1;
        }
        if (e.attendance.length > 0) markedSessions += 1;

        const view: BoardSessionView = {
          id: e.id,
          batchId: b.id,
          batchName: b.name,
          batchLine: b.line,
          title: e.title,
          framework: e.framework,
          dateYmd,
          // IST midnight is how "no clock set" is stored, so it reads back as no time rather
          // than as a class at midnight - the same guard as every other session read.
          timeHm: timeHm === "00:00" ? null : timeHm,
          startsAt: e.startsAt.toISOString(),
          durationMins: e.durationMins,
          joinUrl: e.joinUrl,
          isPast: end < nowMs,
          rosterSize,
          markedCount: e.attendance.length,
          checkedInCount: e.attendance.filter((a) => a.source === "SELF").length,
          attendedCount: e.attendance.filter((a) => isAttended(a.status as AttendanceStatus)).length,
          windowState: state,
          windowClosesAt: e.attendanceClosesAt?.toISOString() ?? null,
          windowRemainingMs: remainingMs(w, now),
          openedByName: e.attendanceOpenedBy?.name ?? e.attendanceOpenedBy?.email ?? null,
          publishedAt: e.attendancePublishedAt?.toISOString() ?? null,
          publishedByName:
            e.attendancePublishedBy?.name ?? e.attendancePublishedBy?.email ?? null,
          canMark,
        };

        /**
         * The lists are not mutually exclusive, and that is intentional for `liveNow` only.
         * A class happening right now appears both as the open register at the top and in
         * today's row beneath it - a tutor scanning today should not find a hole where the
         * class they are teaching ought to be. Everything else is placed exactly once, in
         * the first bucket it qualifies for, so no chore can be done twice.
         */
        if (state === "OPEN") liveNow.push(view);
        if (dateYmd === todayYmd) today.push(view);
        else if (view.isPast && e.attendance.length === 0 && canMark) outstanding.push(view);
        else if (view.isPast && e.attendance.length > 0 && !e.attendancePublishedAt && canMark) {
          unpublished.push(view);
        } else if (view.isPast && e.attendance.length > 0) recent.push(view);
      }

      batchViews.push({
        id: b.id,
        name: b.name,
        code: b.code,
        line: b.line,
        level: b.level,
        rosterSize,
        liveSessions: b.events.length,
        markedSessions,
        attendancePct: countedTotal > 0 ? Math.round((attendedTotal / countedTotal) * 100) : null,
        iLead: b.tutorId === userId,
        href: b.line === "B2" ? `/batches/${b.id}` : `/german-note/${b.id}`,
      });
    }

    // Soonest first for anything still to come; most recent first for anything owed, because
    // the class you have just taught is the one you are about to mark.
    today.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    liveNow.sort((a, b) => a.windowRemainingMs - b.windowRemainingMs);
    outstanding.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    unpublished.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    recent.sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    // Only cohorts this person may act on - see the note on `catchUp` above.
    const markableIds = batchViews.filter((b) => b.iLead || supervisor).map((b) => b.id);
    const catchUp = await getCatchUpRows(markableIds, now);

    return {
      role: session.role,
      selfCheckInEnabled: config.selfCheckInEnabled,
      defaultWindowMins: config.checkInWindowMins,
      defaultGraceMins: config.checkInLateAfterMins,
      publishRequired: config.publishRequired,
      catchUpHours: config.catchUpHours,
      supervising,
      catchUp,
      liveNow,
      today,
      outstanding: outstanding.slice(0, 30),
      unpublished: unpublished.slice(0, 30),
      recent: recent.slice(0, 10),
      batches: batchViews,
    };
  },
);
