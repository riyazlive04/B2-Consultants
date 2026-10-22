import "server-only";
import type { WhatsAppKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWatiRuntime } from "@/lib/wati";
import { formatClassTime } from "@/lib/class-reminder";
import { accessLabel, catchUpState, isRecordingAvailable } from "@/lib/recording-access";
import { resolveWatchTruth } from "@/lib/video-progress";
import { sendWhatsApp, type SendOutcome } from "./whatsapp";
import { getAttendanceConfig } from "./founder-config";

/**
 * MISSED A CLASS - the outbound half.
 *
 * Two touchpoints on one sweep, because they read the same three facts a few hours apart:
 *   · CLASS_ABSENCE - "you were marked absent from X", once per student per class.
 *   · CLASS_CATCH_UP - "you still have not watched the recording", once the catch-up grace has
 *     run out and only while the recording can still be opened.
 *
 * ── Published registers ONLY ────────────────────────────────────────────────────────────
 * The query requires `attendancePublishedAt`. A student must never be messaged about a mark
 * their own classroom is still hiding from them - that is the publish switch's entire purpose,
 * and a WhatsApp that outran it would be a judgement the student cannot look up, dispute or
 * even confirm arrived about the right class.
 *
 * ── Idempotence, which is the whole problem ─────────────────────────────────────────────
 * Same answer as `class-reminders.ts`: the `WhatsAppMessage` rows carrying this class's id ARE
 * the record of what was sent, read per class rather than per student. A separate table would
 * be a second record of the same fact, free to disagree with the WhatsApp screen the founder
 * actually looks at. One message per (class, student, kind), forever - an absence does not
 * become newsworthy again on the next tick.
 *
 * ── Why it ships off ───────────────────────────────────────────────────────────────────
 * `classAbsenceEnabled` and `classCatchUpEnabled` both default false, and
 * `classFollowUpDryRun` defaults true. Unlike a reminder, these two carry a JUDGEMENT about
 * somebody - and the live WATI account sends to real numbers with no test recipient set. A dry
 * run writes the full SKIPPED row, naming the recipient, the template and the resolved text, so
 * the exact blast can be read before one real message leaves.
 */

export type AbsenceNoticeRun = {
  enabled: boolean;
  reason?: string;
  ranAt: string;
  /** Absence marks inspected on this tick. */
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
};

const empty = (over: Partial<AbsenceNoticeRun>): AbsenceNoticeRun => ({
  enabled: false,
  ranAt: new Date().toISOString(),
  considered: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  dryRun: true,
  ...over,
});

/** First name only - "Hi Priya Raman," reads like a letter from a bank. */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full.trim();
}

/**
 * How far back the sweep looks.
 *
 * Fourteen days. A register published three weeks late should not suddenly message a cohort
 * about a class they have all long since forgotten - at that point the absence is a record, not
 * news, and the coach is better off saying so in person. It is also the blast-radius guard: a
 * founder arming this for the first time on a six-month-old database gets a fortnight, not
 * every absence ever recorded.
 */
const LOOKBACK_DAYS = 14;

export async function runAbsenceNotices(): Promise<AbsenceNoticeRun> {
  const ranAt = new Date().toISOString();
  const runtime = await getWatiRuntime();

  if (!runtime.enabled) {
    const reason = !runtime.envEnabled
      ? "WATI_ENABLED is not set"
      : runtime.paused
        ? "WhatsApp is paused in settings"
        : "WATI is not configured (endpoint/token missing)";
    return empty({ ranAt, reason });
  }

  const cadence = runtime.settings.cadence;
  const hasTemplate = (kind: WhatsAppKind) => !!runtime.settings.templates[kind]?.name;
  const absenceOn = cadence.classAbsenceEnabled && hasTemplate("CLASS_ABSENCE");
  const catchUpOn = cadence.classCatchUpEnabled && hasTemplate("CLASS_CATCH_UP");

  if (!cadence.classAbsenceEnabled && !cadence.classCatchUpEnabled) {
    return empty({ ranAt, reason: "Absence and catch-up notices are switched off in Cadence" });
  }
  // A touchpoint with no template bound would otherwise write one SKIPPED row per student per
  // tick - the same per-candidate spam the other engines avoid.
  if (!absenceOn && !catchUpOn) {
    return empty({ ranAt, reason: "No absence or catch-up template is bound in WhatsApp → Settings" });
  }

  const config = await getAttendanceConfig();
  const dryRun = cadence.classFollowUpDryRun;
  const now = new Date();

  const marks = await prisma.sessionAttendance.findMany({
    where: {
      status: "ABSENT",
      session: {
        delivery: "LIVE",
        startsAt: { gte: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) },
        // See the note above - never ahead of what the student can see for themselves.
        attendancePublishedAt: { not: null },
        batch: { status: "ACTIVE" },
      },
    },
    orderBy: { session: { startsAt: "desc" } },
    take: 500,
    select: {
      studentId: true,
      student: { select: { fullName: true, phone: true, userId: true } },
      session: {
        select: {
          id: true,
          title: true,
          startsAt: true,
          recording: {
            select: { id: true, videoUrl: true, createdAt: true, availableUntil: true },
          },
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let budget = Math.max(0, cadence.maxPerRun);

  const tally = (out: SendOutcome) => {
    if (out.sent) { sent++; budget--; }
    else if (out.status === "FAILED") { failed++; budget--; }
    else skipped++;
  };

  /**
   * Everything already sent for these classes, in ONE read per kind.
   *
   * Grouped by `(classSessionId, studentId)`, which is the exact shape of the question "have we
   * already told this person about this class".
   */
  const sessionIds = [...new Set(marks.map((m) => m.session.id))];
  const priorRows = sessionIds.length
    ? await prisma.whatsAppMessage.findMany({
        where: {
          classSessionId: { in: sessionIds },
          kind: { in: ["CLASS_ABSENCE", "CLASS_CATCH_UP"] },
          direction: "OUTBOUND",
        },
        select: { classSessionId: true, studentId: true, kind: true },
      })
    : [];
  const alreadySent = new Set(
    priorRows
      .filter((r) => r.classSessionId && r.studentId)
      .map((r) => `${r.classSessionId}:${r.studentId}:${r.kind}`),
  );

  // Watch rows for every recording in play, so the catch-up half can tell who is already done.
  const recordingIds = [
    ...new Set(marks.map((m) => m.session.recording?.id).filter((x): x is string => !!x)),
  ];
  const userIds = [...new Set(marks.map((m) => m.student.userId).filter((x): x is string => !!x))];
  const watches =
    recordingIds.length && userIds.length
      ? await prisma.gnRecordingWatch.findMany({
          where: { recordingId: { in: recordingIds }, userId: { in: userIds } },
          select: { recordingId: true, userId: true, watchedPct: true, selfReported: true },
        })
      : [];
  const watchBy = new Map(watches.map((w) => [`${w.recordingId}:${w.userId}`, w]));

  for (const m of marks) {
    if (budget <= 0) break;
    const s = m.session;
    const rec = s.recording;
    const classWhen = formatClassTime(s.startsAt);
    /**
     * The link is withheld once the window has closed.
     *
     * Sending a URL a student will be refused at is worse than sending none: the message would
     * read as "here is the recording" and the page would say no. The link-less template variant
     * exists for exactly this, and points them at their classroom instead.
     */
    const linkUsable = rec !== null && isRecordingAvailable(rec.availableUntil, now);
    const vars = {
      name: firstName(m.student.fullName),
      class_title: s.title,
      class_date: classWhen,
      recording_url: linkUsable ? rec!.videoUrl : "",
      watch_deadline: rec ? accessLabel(rec.availableUntil, now) : "Your coach has not posted it yet",
    };

    // ── 1. The absence notice: once, as soon as the register is published ──
    if (absenceOn && !alreadySent.has(`${s.id}:${m.studentId}:CLASS_ABSENCE`)) {
      tally(
        await sendWhatsApp({
          kind: "CLASS_ABSENCE",
          to: m.student.phone,
          studentId: m.studentId,
          classSessionId: s.id,
          runtime,
          dryRun,
          vars,
          bodySummary: `Absent from ${s.title}`,
        }),
      );
      if (budget <= 0) break;
    }

    // ── 2. The catch-up chase: only once overdue, and only while the video can be opened ──
    if (!catchUpOn || alreadySent.has(`${s.id}:${m.studentId}:CLASS_CATCH_UP`)) continue;

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
    /**
     * OVERDUE only.
     *
     * Not `needsFollowUp`, which also admits `NO_RECORDING` and `WINDOW_CLOSED`. Both of those
     * are the COACH's problem: one is a video we never posted, the other a window we let close.
     * Messaging a student about either would be blaming them for our own omission, which is
     * why those two appear on the coach's desk and reach nobody's phone.
     */
    if (state !== "OVERDUE") continue;

    tally(
      await sendWhatsApp({
        kind: "CLASS_CATCH_UP",
        to: m.student.phone,
        studentId: m.studentId,
        classSessionId: s.id,
        runtime,
        dryRun,
        vars,
        bodySummary: `Catch up on ${s.title} (${truth.pct}% watched)`,
      }),
    );
  }

  return { enabled: true, ranAt, considered: marks.length, sent, skipped, failed, dryRun };
}
