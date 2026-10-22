import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { resolveWatchTruth } from "@/lib/video-progress";
import {
  accessLabel,
  catchUpState,
  hoursSince,
  needsFollowUp,
  CATCH_UP_RANK,
  type CatchUpState,
} from "@/lib/recording-access";
import { getAttendanceConfig } from "./founder-config";

/**
 * WHO MISSED A CLASS AND HAS NOT CAUGHT UP - the founders' "section for when they are not
 * watching the recordings within 24 hours".
 *
 * ── Derived, with no new table ──────────────────────────────────────────────────────────
 * Everything this needs already existed and was never joined up: `SessionAttendance` knows who
 * was absent, `GnRecording` knows whether the video was posted and (now) how long it stays
 * visible, and `GnRecordingWatch` has tracked a real watched-percentage since the video
 * progress work. The gap was not data, it was that nobody ever asked the three of them one
 * question. A `catch_up` table would have been a fourth record of facts the other three
 * already hold, free to disagree with them.
 *
 * ── The watched test is the TRACKED one ─────────────────────────────────────────────────
 * `resolveWatchTruth` decides, which means a student who ticked "watched" at 40% is still
 * overdue. That rule predates this list (spec §10.3) and the whole point of reusing it is that
 * a coach chasing a student can say "you are at 40%", not "the box is unticked".
 *
 * ── Why a missing recording is on this list ─────────────────────────────────────────────
 * `NO_RECORDING` rows are the coach's own chore and the only ones they can fix themselves.
 * Leaving them off would make the list quietly flatter whenever the real failure was ours -
 * agreement §3.3 promises the recording - and would blame a student for not watching a video
 * that does not exist.
 */

export type CatchUpRow = {
  studentId: string;
  studentName: string;
  studentCode: string | null;
  /** False when the student has no portal login, which is why they cannot watch anything. */
  hasLogin: boolean;

  sessionId: string;
  sessionTitle: string;
  classDateYmd: string;
  batchId: string;
  batchName: string;

  recordingId: string | null;
  recordingPostedAt: string | null;
  /** Whole hours since the video went up - the "24 hours and counting" figure. */
  hoursSinceRecording: number | null;
  availableUntil: string | null;
  /** "3 days left to watch" / "No time limit" / "No longer available". */
  accessLabel: string;

  watchedPct: number;
  /** Where the percentage came from, so a disputed tick is legible. */
  watchBasis: "tracked" | "self_reported" | "none";
  /** True when the student ticked watched but the tracking disagrees. */
  watchDisputed: boolean;

  state: CatchUpState;
};

/**
 * How far back the list looks.
 *
 * Sixty days, which comfortably covers a four-week B2 cohort plus its sprint and a German Note
 * tutor who has let things slide for a month. Past that an unwatched recording is history: the
 * access window has very likely closed, and a list that never forgets becomes one nobody reads.
 */
const LOOKBACK_DAYS = 60;

function istYmd(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The rows, for a given set of cohorts.
 *
 * Takes batch ids rather than a session so the caller decides the scope - the Attendance desk
 * passes the cohorts this viewer may mark, which is already computed there. An empty list in
 * means an empty list out, with no query.
 */
export async function getCatchUpRows(batchIds: string[], now = new Date()): Promise<CatchUpRow[]> {
  if (batchIds.length === 0) return [];
  const config = await getAttendanceConfig();

  /**
   * ABSENT only.
   *
   * Not LATE - they were in the room, and sending them to the recording would be telling
   * somebody who attended that they missed it. Not EXCUSED either: an excused absence is the
   * student having told somebody, which is the behaviour we want, and putting them on a
   * chase-list punishes it. Same rule as `isCounted` in lib/attendance.ts draws.
   */
  const marks = await prisma.sessionAttendance.findMany({
    where: {
      status: "ABSENT",
      session: {
        batchId: { in: batchIds },
        delivery: "LIVE",
        startsAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) },
      },
    },
    select: {
      studentId: true,
      student: { select: { fullName: true, code: true, userId: true } },
      session: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          batchId: true,
          batch: { select: { name: true } },
          recording: { select: { id: true, createdAt: true, availableUntil: true } },
        },
      },
    },
    // A runaway guard, not a real ceiling: six cohorts of eight over two months is ~400 rows
    // even if nobody ever attends anything.
    take: 2000,
  });
  if (marks.length === 0) return [];

  /**
   * Watch rows in ONE read, keyed on (recordingId, userId).
   *
   * `GnRecordingWatch` is keyed on `User`, not `Student` - it was built for the portal's own
   * progress bars. So a student with no login has no row and never can have one, which is why
   * `hasLogin` is on the row rather than being silently read as "has not watched".
   */
  const recordingIds = [...new Set(marks.map((m) => m.session.recording?.id).filter((x): x is string => !!x))];
  const userIds = [...new Set(marks.map((m) => m.student.userId).filter((x): x is string => !!x))];

  const watches =
    recordingIds.length && userIds.length
      ? await prisma.gnRecordingWatch.findMany({
          where: { recordingId: { in: recordingIds }, userId: { in: userIds } },
          select: { recordingId: true, userId: true, watchedPct: true, selfReported: true },
        })
      : [];
  const watchBy = new Map(watches.map((w) => [`${w.recordingId}:${w.userId}`, w]));

  const rows: CatchUpRow[] = marks.map((m) => {
    const rec = m.session.recording;
    const key = rec && m.student.userId ? `${rec.id}:${m.student.userId}` : null;
    const w = key ? watchBy.get(key) ?? null : null;
    const truth = resolveWatchTruth({
      watchedPct: w?.watchedPct ?? null,
      selfReported: w?.selfReported ?? false,
    });

    const state = catchUpState(
      {
        recordingPostedAt: rec?.createdAt ?? null,
        availableUntil: rec?.availableUntil ?? null,
        watchComplete: truth.complete,
        graceHours: config.catchUpHours,
      },
      now,
    );

    return {
      studentId: m.studentId,
      studentName: m.student.fullName,
      studentCode: m.student.code,
      hasLogin: m.student.userId !== null,
      sessionId: m.session.id,
      sessionTitle: m.session.title,
      classDateYmd: istYmd(m.session.startsAt),
      batchId: m.session.batchId,
      batchName: m.session.batch.name,
      recordingId: rec?.id ?? null,
      recordingPostedAt: rec?.createdAt.toISOString() ?? null,
      hoursSinceRecording: rec ? hoursSince(rec.createdAt, now) : null,
      availableUntil: rec?.availableUntil?.toISOString() ?? null,
      accessLabel: rec ? accessLabel(rec.availableUntil, now) : "No recording posted",
      watchedPct: truth.pct,
      watchBasis: truth.basis,
      watchDisputed: truth.disputed,
      state,
    };
  });

  // Worst first - this list exists to be worked from the top, not browsed. Within a state, the
  // longest-waiting class first: a three-week-old gap is worse than yesterday's.
  return rows
    .filter((r) => needsFollowUp(r.state))
    .sort(
      (a, b) =>
        CATCH_UP_RANK[a.state] - CATCH_UP_RANK[b.state] ||
        a.classDateYmd.localeCompare(b.classDateYmd) ||
        a.studentName.localeCompare(b.studentName),
    );
}

export type MyCatchUp = {
  sessionId: string;
  sessionTitle: string;
  batchName: string;
  classDateYmd: string;
  recordingId: string | null;
  availableUntil: string | null;
  accessLabel: string;
  watchedPct: number;
  state: CatchUpState;
};

/**
 * The same question, asked about the signed-in student only.
 *
 * Keyed on `User.id` like every other student read, so the caller cannot ask about somebody
 * else. It drives the student's own in-app nudge, and it deliberately includes `IN_GRACE`
 * rows: the point of telling a student is to reach them BEFORE they are late, which is the one
 * audience for whom the pre-deadline state is the useful one.
 */
export const getMyCatchUp = cache(async (userId: string): Promise<MyCatchUp[]> => {
  const config = await getAttendanceConfig();
  const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
  if (!student) return [];

  const now = new Date();
  const marks = await prisma.sessionAttendance.findMany({
    where: {
      studentId: student.id,
      status: "ABSENT",
      session: {
        delivery: "LIVE",
        startsAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) },
        batch: { status: "ACTIVE" },
        /**
         * PUBLISHED ONLY, and this is the half that keeps the two features honest.
         *
         * A student must not be nudged to catch up on a class whose register their own
         * classroom still shows as un-marked - they would be told off for an absence the app
         * is simultaneously hiding from them. See `studentMaySeeMark`.
         */
        attendancePublishedAt: config.publishRequired ? { not: null } : undefined,
      },
    },
    select: {
      session: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          batch: { select: { name: true } },
          recording: { select: { id: true, createdAt: true, availableUntil: true } },
        },
      },
    },
    orderBy: { session: { startsAt: "desc" } },
    take: 20,
  });
  if (marks.length === 0) return [];

  const recordingIds = [...new Set(marks.map((m) => m.session.recording?.id).filter((x): x is string => !!x))];
  const watches = recordingIds.length
    ? await prisma.gnRecordingWatch.findMany({
        where: { recordingId: { in: recordingIds }, userId },
        select: { recordingId: true, watchedPct: true, selfReported: true },
      })
    : [];
  const watchBy = new Map(watches.map((w) => [w.recordingId, w]));

  return marks
    .map((m) => {
      const rec = m.session.recording;
      const w = rec ? watchBy.get(rec.id) ?? null : null;
      const truth = resolveWatchTruth({
        watchedPct: w?.watchedPct ?? null,
        selfReported: w?.selfReported ?? false,
      });
      const state = catchUpState(
        {
          recordingPostedAt: rec?.createdAt ?? null,
          availableUntil: rec?.availableUntil ?? null,
          watchComplete: truth.complete,
          graceHours: config.catchUpHours,
        },
        now,
      );
      return {
        sessionId: m.session.id,
        sessionTitle: m.session.title,
        batchName: m.session.batch.name,
        classDateYmd: istYmd(m.session.startsAt),
        recordingId: rec?.id ?? null,
        availableUntil: rec?.availableUntil?.toISOString() ?? null,
        accessLabel: rec ? accessLabel(rec.availableUntil, now) : "Your coach has not posted it yet",
        watchedPct: truth.pct,
        state,
      };
    })
    /**
     * What the STUDENT is shown, which is not what the coach is shown.
     *
     * `IN_GRACE` and `OVERDUE` are both here - reaching someone before the deadline is the
     * entire point. `WINDOW_CLOSED` is dropped: telling a student off for a recording they can
     * no longer open is a complaint, not a nudge, and the only person who can act on it is the
     * coach. `NO_RECORDING` is dropped for the same reason - it is our failing, not theirs.
     */
    .filter((r) => r.state === "IN_GRACE" || r.state === "OVERDUE")
    .sort((a, b) => CATCH_UP_RANK[a.state] - CATCH_UP_RANK[b.state] || a.classDateYmd.localeCompare(b.classDateYmd));
});

export type AbsenceQuestion = {
  sessionId: string;
  sessionTitle: string;
  batchName: string;
  classDateYmd: string;
  askedAt: string;
  askedByName: string | null;
};

/**
 * "Your coach asked why you missed this" - the student's outstanding questions.
 *
 * Lives beside `getMyCatchUp` because it is the same subject from the same side: things about
 * a class you missed. Keyed on `User.id` like every other student read.
 *
 * ── Only ones actually ASKED, and only ones still unanswered ───────────────────────────
 * `reasonAskedAt` set and `reason` null. Both halves matter: without the first this would be
 * the always-on "why were you away?" form the founders specifically did not want, and without
 * the second a student would be re-prompted forever about something they had already explained.
 *
 * Deliberately NOT gated on the register being published. A coach who asks the question has
 * told the student about the absence by asking - holding the prompt back until publication
 * would mean a question the student can see was asked but not what it is about.
 */
export const getMyAbsenceQuestions = cache(async (userId: string): Promise<AbsenceQuestion[]> => {
  const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
  if (!student) return [];

  const rows = await prisma.sessionAttendance.findMany({
    where: {
      studentId: student.id,
      status: "ABSENT",
      reasonAskedAt: { not: null },
      reason: null,
    },
    orderBy: { reasonAskedAt: "desc" },
    take: 10,
    select: {
      reasonAskedAt: true,
      reasonAskedBy: { select: { name: true, email: true } },
      session: {
        select: { id: true, title: true, startsAt: true, batch: { select: { name: true } } },
      },
    },
  });

  return rows.map((r) => ({
    sessionId: r.session.id,
    sessionTitle: r.session.title,
    batchName: r.session.batch.name,
    classDateYmd: istYmd(r.session.startsAt),
    askedAt: r.reasonAskedAt!.toISOString(),
    askedByName: r.reasonAskedBy?.name ?? r.reasonAskedBy?.email ?? null,
  }));
});
