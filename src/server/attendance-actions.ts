"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { canManageDelivery } from "./batch-access";
import {
  closeCheckInWindow,
  fillUnmarked,
  getAttendanceSheet,
  openCheckInWindow,
  saveAttendance,
  setAttendancePublished,
  type AttendanceSheet,
} from "./attendance";
import { getAttendanceConfig } from "./founder-config";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Marking the register.
 *
 * Guarded on the BATCH, not on a section: Admin, whoever holds `batches.manage`, or the person
 * assigned to run this cohort - a German Note tutor or a B2 coach alike. The check is re-run
 * here rather than trusted from the UI - a hidden button is never the fence.
 */

const markSchema = z.object({
  sessionId: z.string().min(1),
  marks: z
    .array(
      z.object({
        studentId: z.string().min(1),
        // null CLEARS the mark. "Never took the register" and "took it and they were absent"
        // are different facts, and only the absence of a row can express the first.
        status: z.enum(["PRESENT", "LATE", "ABSENT", "EXCUSED"]).nullable(),
        note: z.string().max(500).nullish(),
      }),
    )
    // A batch targets ~8 students; 200 is a runaway guard, not a real ceiling.
    .max(200),
});

/**
 * Admin, whoever holds `batches.manage`, or the person who leads this cohort.
 *
 * Not `requireSection("german-note")`: a B2 coach has no German Note section, and gating the
 * register on it would mean the one person standing in front of the class cannot take it. The
 * batch check below is - and always was - the real fence; see the note in `session-tasks.ts`.
 */
async function canMark(
  session: { role: string; user: { id: string }; capabilities?: unknown },
  batchId: string,
): Promise<boolean> {
  // ONE rule, in server/batch-access.ts. This used to be a local copy carrying a comment
  // warning that it had to agree with two other local copies - which is how the German Note
  // one came to refuse anyone who is not a TUTOR while this one honoured `batches.manage`.
  return canManageDelivery(
    { role: session.role, user: session.user, capabilities: (session.capabilities ?? null) as never },
    batchId,
  );
}

/**
 * The guard every window action shares: find the class, check the fence, refuse a video.
 *
 * Written once because four actions need the identical three checks, and a register that could
 * be opened on a pre-recorded module would invite a cohort to check in to a video.
 */
async function loadMarkable(
  sessionId: string,
  session: { role: string; user: { id: string }; capabilities?: unknown },
): Promise<
  | { ok: true; classSession: { id: string; title: string; batchId: string; startsAt: Date } }
  | { ok: false; error: string }
> {
  const classSession = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, batchId: true, startsAt: true, delivery: true },
  });
  if (!classSession) return { ok: false, error: "Session not found" };
  if (classSession.delivery === "PRE_RECORDED") {
    return { ok: false, error: "A pre-recorded module has no register - there is no room to be in." };
  }
  if (!(await canMark(session, classSession.batchId))) return { ok: false, error: "Not allowed" };
  return { ok: true, classSession };
}

/**
 * Every screen that reads a register, refreshed together.
 *
 * Six paths, and the list is this long because the same fact is deliberately shown in six
 * places: the new board, the cohort timetable, the teaching desk, the German Note schedule and
 * both student screens. Missing one is how a student presses "I'm here", sees the tick on the
 * dashboard, and finds their classroom still saying the register was never taken.
 */
function revalidateAttendance(batchId: string): void {
  revalidatePath("/attendance");
  revalidatePath(`/batches/${batchId}`);
  revalidatePath(`/german-note/${batchId}`);
  revalidatePath("/german-note");
  revalidatePath("/coaching");
  revalidatePath("/classroom");
  revalidatePath("/dashboard");
}

export async function markAttendance(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = markSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const classSession = await prisma.classSession.findUnique({
    where: { id: parsed.data.sessionId },
    select: { id: true, title: true, batchId: true, startsAt: true },
  });
  if (!classSession) return { ok: false, error: "Session not found" };
  if (!(await canMark(session, classSession.batchId))) return { ok: false, error: "Not allowed" };

  // Marking a class that hasn't happened yet is almost certainly a misclick on the wrong row -
  // and a register full of absences for a future date would quietly turn every student red.
  // A small grace window lets a tutor mark during the session rather than only after it.
  if (classSession.startsAt.getTime() > Date.now() + 60 * 60 * 1000) {
    return { ok: false, error: "That class hasn't started yet." };
  }

  const result = await saveAttendance(parsed.data.sessionId, parsed.data.marks, session.user.id);

  await logActivity(session, {
    action: "gn.attendance.mark",
    section: "german-note",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `Marked attendance for "${classSession.title}" (${result.saved} student${result.saved === 1 ? "" : "s"})`,
    meta: { batchId: classSession.batchId, saved: result.saved, cleared: result.cleared },
  });

  revalidateAttendance(classSession.batchId);
  return { ok: true };
}

/**
 * OPEN THE REGISTER - the switch this whole feature is built around.
 *
 * For the next few minutes the students seated in this cohort, and nobody else, see a live
 * "I'm here" button. The register fills itself from the room while the tutor is still
 * teaching, and what is left for the tutor afterwards is two or three corrections rather than
 * eight boxes filled in from memory.
 */
const openSchema = z.object({
  sessionId: z.string().min(1),
  minutes: z.coerce.number().int().min(1).max(240),
  /**
   * `z.coerce.boolean()` is banned on this codebase and it is worth repeating why: it is
   * JavaScript truthiness, so `"false"` from a form field parses as TRUE. An enum of two
   * strings is the only form that survives a round trip through FormData.
   */
  graceMins: z.coerce.number().int().min(0).max(240),
});

export async function openAttendanceWindow(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (parsed.data.graceMins > parsed.data.minutes) {
    return { ok: false, error: "The grace period cannot be longer than the window itself." };
  }

  const loaded = await loadMarkable(parsed.data.sessionId, session);
  if (!loaded.ok) return loaded;
  const { classSession } = loaded;

  const config = await getAttendanceConfig();
  if (!config.selfCheckInEnabled) {
    return { ok: false, error: "Self check-in is switched off in Console → Attendance." };
  }

  /**
   * A DAY EITHER SIDE, which is wider than the one-hour guard on marking and narrower than
   * nothing at all.
   *
   * Marking a future class is almost always a misclick on the wrong row; OPENING one an hour
   * early is a tutor being organised. But a window opened on next month's class would sit on
   * every student's dashboard inviting them to check in to a class that has not happened,
   * and those check-ins would be indistinguishable from real ones.
   */
  const start = classSession.startsAt.getTime();
  const DAY = 86_400_000;
  if (start > Date.now() + DAY) {
    return { ok: false, error: "That class is more than a day away." };
  }
  if (start < Date.now() - DAY) {
    return {
      ok: false,
      error: "That class was over a day ago - mark the register by hand instead of inviting check-ins.",
    };
  }

  const { closesAt } = await openCheckInWindow(parsed.data.sessionId, {
    minutes: parsed.data.minutes,
    graceMins: parsed.data.graceMins,
    openedById: session.user.id,
  });

  await logActivity(session, {
    action: "attendance.window.open",
    section: "attendance",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `Opened attendance for "${classSession.title}" for ${parsed.data.minutes} minutes`,
    meta: {
      batchId: classSession.batchId,
      minutes: parsed.data.minutes,
      graceMins: parsed.data.graceMins,
      closesAt: closesAt.toISOString(),
    },
  });

  revalidateAttendance(classSession.batchId);
  return { ok: true };
}

/** Shuts the register now - for a tutor who can see the room is complete. */
export async function closeAttendanceWindow(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const loaded = await loadMarkable(parsed.data.sessionId, session);
  if (!loaded.ok) return loaded;
  const { classSession } = loaded;

  await closeCheckInWindow(parsed.data.sessionId);
  await logActivity(session, {
    action: "attendance.window.close",
    section: "attendance",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `Closed attendance for "${classSession.title}"`,
    meta: { batchId: classSession.batchId },
  });

  revalidateAttendance(classSession.batchId);
  return { ok: true };
}

/**
 * SHOW THE REGISTER TO THE COHORT, or take it back out of their view.
 *
 * A separate decision from taking it, and separate on purpose: at the moment a window closes
 * the register is a list of everyone who did not press a button, and the tutor has not yet
 * excused the student who emailed in sick. Publishing is the tutor saying the list is now
 * right. Unpublishing exists because a mistake spotted after the fact needs an undo that is
 * not "delete everyone's marks".
 */
export async function setAttendanceVisibility(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = z
    .object({
      sessionId: z.string().min(1),
      // Not z.coerce.boolean() - see openSchema.
      published: z.enum(["true", "false"]).transform((v) => v === "true"),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const loaded = await loadMarkable(parsed.data.sessionId, session);
  if (!loaded.ok) return loaded;
  const { classSession } = loaded;

  if (parsed.data.published) {
    const marked = await prisma.sessionAttendance.count({ where: { sessionId: classSession.id } });
    // Publishing an empty register would tell every student in the cohort that no record of
    // them exists, in a screen whose whole purpose is to show them their record.
    if (marked === 0) {
      return { ok: false, error: "There is nothing to show yet - take the register first." };
    }
  }

  await setAttendancePublished(classSession.id, parsed.data.published, session.user.id);
  await logActivity(session, {
    action: parsed.data.published ? "attendance.publish" : "attendance.unpublish",
    section: "attendance",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `${parsed.data.published ? "Showed" : "Hid"} attendance for "${classSession.title}" ${
      parsed.data.published ? "to" : "from"
    } the batch`,
    meta: { batchId: classSession.batchId },
  });

  revalidateAttendance(classSession.batchId);
  return { ok: true };
}

/**
 * "Mark the rest absent" - the one press that finishes a register the room has mostly filled.
 *
 * Only unmarked students are touched, so a student excused ten seconds earlier is not
 * flattened by the convenience button. ABSENT and EXCUSED are both offered: a class that
 * clashed with a public holiday is a sheet full of excuses, not absences.
 */
export async function fillUnmarkedAttendance(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = z
    .object({
      sessionId: z.string().min(1),
      status: z.enum(["ABSENT", "EXCUSED", "PRESENT"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const loaded = await loadMarkable(parsed.data.sessionId, session);
  if (!loaded.ok) return loaded;
  const { classSession } = loaded;

  // Same guard as marking: a register full of absences for a class that has not happened
  // would quietly turn every student in the cohort red.
  if (classSession.startsAt.getTime() > Date.now() + 60 * 60 * 1000) {
    return { ok: false, error: "That class hasn't started yet." };
  }

  const { filled } = await fillUnmarked(classSession.id, parsed.data.status, session.user.id);
  if (filled === 0) return { ok: false, error: "Everyone already has a mark." };

  await logActivity(session, {
    action: "attendance.fill",
    section: "attendance",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `Marked the remaining ${filled} student${filled === 1 ? "" : "s"} ${parsed.data.status.toLowerCase()} for "${classSession.title}"`,
    meta: { batchId: classSession.batchId, filled, status: parsed.data.status },
  });

  revalidateAttendance(classSession.batchId);
  return { ok: true };
}

/**
 * Loads a register for the client sheet.
 *
 * A server ACTION rather than props on the page: a batch's calendar can hold dozens of sessions
 * and only one register is ever open at a time. Shipping every roster for every session on page
 * load would be the bulk of the payload for something almost none of it is used.
 */
export async function loadAttendanceSheet(
  sessionId: string,
): Promise<{ ok: true; sheet: AttendanceSheet } | { ok: false; error: string }> {
  const session = await requireSession();
  const sheet = await getAttendanceSheet(sessionId);
  if (!sheet) return { ok: false, error: "Session not found" };
  if (!(await canMark(session, sheet.batchId))) return { ok: false, error: "Not allowed" };
  return { ok: true, sheet };
}

/**
 * "ASK WHY" - the only way an absence reason is ever requested.
 *
 * The founders were specific: capture the reason only when nudged by the head coach or the
 * tutor. So there is no standing "why were you away?" field anywhere in the student portal.
 * A coach presses this on the one absence they actually want explained, and only then does the
 * student see a box.
 *
 * ── Why that restraint is the feature ──────────────────────────────────────────────────
 * An always-on reason box on every missed class is a form nobody fills in, and the silence it
 * produces is indistinguishable from not caring - which is precisely the distinction a coach
 * needs. Asking rarely is what makes an unanswered question mean something.
 *
 * Only ABSENT rows can be asked about. Not LATE (they were there) and not EXCUSED, which
 * already means somebody knows why - asking again would be the app failing to read its own
 * record.
 *
 * Idempotent: asking twice does not reset a question already answered, so a coach clicking
 * again cannot wipe the student's words.
 */
export async function askAbsenceReason(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = z
    .object({ sessionId: z.string().min(1), studentId: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const loaded = await loadMarkable(parsed.data.sessionId, session);
  if (!loaded.ok) return loaded;
  const { classSession } = loaded;

  const mark = await prisma.sessionAttendance.findUnique({
    where: {
      sessionId_studentId: { sessionId: classSession.id, studentId: parsed.data.studentId },
    },
    select: { id: true, status: true, reasonAskedAt: true, reason: true, student: { select: { fullName: true } } },
  });
  if (!mark) return { ok: false, error: "That student has no mark on this class yet." };
  if (mark.status !== "ABSENT") {
    return { ok: false, error: "Only an absence can be queried - this one is marked " + mark.status.toLowerCase() + "." };
  }
  if (mark.reason) return { ok: false, error: "They have already answered." };
  if (mark.reasonAskedAt) return { ok: true }; // already asked; nothing to change

  await prisma.sessionAttendance.update({
    where: { id: mark.id },
    data: { reasonAskedAt: new Date(), reasonAskedById: session.user.id },
  });

  await logActivity(session, {
    action: "attendance.reason.ask",
    section: "attendance",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `Asked ${mark.student.fullName} why they missed "${classSession.title}"`,
    meta: { batchId: classSession.batchId, studentId: parsed.data.studentId },
  });

  revalidateAttendance(classSession.batchId);
  return { ok: true };
}

/**
 * A coach excusing an absence once they have read the reason.
 *
 * Offered beside the answer because that is the decision the answer exists to inform, and
 * making the coach reopen the register to act on what they just read is how a reason box
 * becomes something nobody bothers to ask for. EXCUSED drops the class out of the student's
 * attendance denominator entirely (`isCounted`), which is the point.
 */
export async function excuseAbsence(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = z
    .object({ sessionId: z.string().min(1), studentId: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const loaded = await loadMarkable(parsed.data.sessionId, session);
  if (!loaded.ok) return loaded;
  const { classSession } = loaded;

  const mark = await prisma.sessionAttendance.findUnique({
    where: {
      sessionId_studentId: { sessionId: classSession.id, studentId: parsed.data.studentId },
    },
    select: { id: true, status: true, student: { select: { fullName: true } } },
  });
  if (!mark) return { ok: false, error: "That student has no mark on this class yet." };
  if (mark.status === "EXCUSED") return { ok: true };

  await prisma.sessionAttendance.update({
    where: { id: mark.id },
    // The verdict is now the coach's, so the provenance says so - but `reason` and `checkedInAt`
    // are left alone, because what the student said happened is still what they said.
    data: { status: "EXCUSED", source: "TUTOR", markedById: session.user.id, markedAt: new Date() },
  });

  await logActivity(session, {
    action: "attendance.excuse",
    section: "attendance",
    entityType: "ClassSession",
    entityId: classSession.id,
    summary: `Excused ${mark.student.fullName} from "${classSession.title}"`,
    meta: { batchId: classSession.batchId, studentId: parsed.data.studentId, was: mark.status },
  });

  revalidateAttendance(classSession.batchId);
  return { ok: true };
}
