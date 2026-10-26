"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireSession } from "@/lib/rbac";
import { canManageDelivery } from "./batch-access";
import { expiryFor, MAX_RECORDING_ACCESS_DAYS } from "@/lib/recording-access";
import { canCancelSession, sessionIsOn } from "@/lib/session-status";
import { getAttendanceConfig } from "./founder-config";
import { planTimetable, sortRows, type CurriculumRow } from "@/lib/curriculum";
import { parseDateInput, istWallToUtc } from "@/lib/dates";
import { parseVideoUrl } from "@/lib/video-embed";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Building and maintaining ONE COHORT'S timetable.
 *
 * ── Why generation writes ordinary sessions and then lets go ────────────────────────────────
 * `generateTimetable` reads the curriculum, dates it against the batch's start, and writes plain
 * `ClassSession` rows. After that the template is history: a batch that moves its Saturday class
 * to the Sunday edits that one session, and editing the TEMPLATE never reaches back into a
 * cohort already running on it. The alternative - a live binding - means a founder fixing a typo
 * in week 2 silently re-dates classes students have already been told about.
 *
 * ── Why re-generating is careful rather than a delete-and-rewrite ───────────────────────────
 * A register and a homework list hang off a session. Wiping and recreating would cascade both
 * away, so "regenerate after moving the start date" would quietly destroy the attendance record
 * of every class already taught. So: future sessions are re-dated in place, sessions that have
 * been MARKED are left exactly as they are, and only untouched orphans are removed.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/**
 * Who may schedule this batch's classes: Admin, whoever holds `batches.manage`, or the person
 * who actually leads the cohort (`Batch.tutorId` - a German Note tutor or a B2 coach).
 *
 * Re-checked on the server for every write. The desk hides what you cannot do, but a hidden
 * button is never the fence.
 */
// The delivery fence lives in server/batch-access.ts - see the note there on why there is now
// one of it rather than three. A Head coach is included, which is what lets them post and
// re-date a recording on a cohort somebody else leads.
const canManageBatch = canManageDelivery;

const generateSchema = z.object({
  templateId: z.string().trim().min(1, "Pick a curriculum"),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
});

export type GenerateSummary = {
  created: number;
  updated: number;
  removed: number;
  /** Sessions left untouched because their register has already been taken. */
  kept: number;
  sprintStartYmd: string | null;
};

/**
 * Generate (or re-generate) a batch's timetable from a curriculum.
 *
 * Idempotent: running it twice with the same inputs changes nothing. The join between a
 * curriculum row and the session it produced is `ClassSession.curriculumItemId`, which is what
 * lets a second run recognise its own work instead of duplicating it.
 */
export async function generateTimetable(
  batchId: string,
  form: FormData,
): Promise<{ ok: true; summary: GenerateSummary } | { ok: false; error: string }> {
  const { allowed, denied, session } = await capabilityCheck("batches.manage");
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, name: true, line: true, status: true, tutorId: true },
  });
  if (!batch) return { ok: false, error: "Batch not found" };
  if (!allowed && !(await canManageBatch(session, batchId))) return denied;
  if (batch.status === "ARCHIVED") return { ok: false, error: "That batch is archived." };

  const parsed = generateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { templateId, startDate } = parsed.data;

  const template = await prisma.curriculumTemplate.findUnique({
    where: { id: templateId },
    include: { items: { orderBy: [{ weekNumber: "asc" }, { orderIndex: "asc" }] } },
  });
  if (!template) return { ok: false, error: "Curriculum not found" };
  if (template.items.length === 0) {
    return { ok: false, error: `"${template.name}" has no sessions in it yet - add the weeks first.` };
  }
  if (template.line !== batch.line) {
    return { ok: false, error: `"${template.name}" is a ${template.line === "B2" ? "B2 Coaching" : "German Note"} curriculum - it does not fit this batch.` };
  }

  const rows: CurriculumRow[] = sortRows(
    template.items.map((i) => ({
      id: i.id,
      weekNumber: i.weekNumber,
      orderIndex: i.orderIndex,
      title: i.title,
      framework: i.framework,
      type: i.type,
      delivery: i.delivery === "PRE_RECORDED" ? ("PRE_RECORDED" as const) : ("LIVE" as const),
      durationMins: i.durationMins,
      dayOfWeek: i.dayOfWeek,
      startTime: i.startTime,
      notes: i.notes,
    })),
  );
  const plan = planTimetable(rows, startDate, { sprintDays: template.sprintDays });

  // Everything this batch has already been given by a curriculum, with the one fact that
  // decides whether it may be moved: has anybody been marked present or absent at it.
  const existing = await prisma.classSession.findMany({
    where: { batchId, curriculumItemId: { not: null } },
    select: { id: true, curriculumItemId: true, _count: { select: { attendance: true, tasks: true } } },
  });
  const byItem = new Map(existing.map((e) => [e.curriculumItemId!, e]));
  const plannedIds = new Set(plan.sessions.map((s) => s.curriculumItemId));

  let created = 0;
  let updated = 0;
  let kept = 0;

  for (const s of plan.sessions) {
    const prior = byItem.get(s.curriculumItemId);
    const data = {
      title: s.title,
      framework: s.framework,
      type: s.type as never,
      delivery: s.delivery as never,
      weekNumber: s.weekNumber,
      orderIndex: s.orderIndex,
      durationMins: s.durationMins,
      startsAt: s.startsAt,
      notes: s.notes,
    };
    if (!prior) {
      await prisma.classSession.create({
        data: { batchId, curriculumItemId: s.curriculumItemId, createdById: session.user.id, ...data },
      });
      created += 1;
    } else if (prior._count.attendance > 0) {
      // Taught and registered. Re-dating it would rewrite history, so it stands.
      kept += 1;
    } else {
      await prisma.classSession.update({ where: { id: prior.id }, data });
      updated += 1;
    }
  }

  // Rows the curriculum no longer has. Only the ones nothing hangs off are removed - a session
  // with a register or coursework against it is evidence, and stays.
  const orphans = existing.filter(
    (e) => !plannedIds.has(e.curriculumItemId!) && e._count.attendance === 0 && e._count.tasks === 0,
  );
  if (orphans.length > 0) {
    await prisma.classSession.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
  }

  await prisma.batch.update({
    where: { id: batchId },
    data: {
      curriculumTemplateId: templateId,
      startDate: parseDateInput(startDate),
      sprintStartDate: plan.sprintStartYmd ? parseDateInput(plan.sprintStartYmd) : null,
      // The programme ends when the sprint does - the sheet's own last row.
      endDate: plan.sprintEndYmd ? parseDateInput(plan.sprintEndYmd) : undefined,
    },
  });

  await logActivity(session, {
    action: "batch.timetable.generate",
    section: batch.line === "B2" ? "students" : "german-note",
    entityType: "Batch",
    entityId: batchId,
    summary: `Built ${batch.name}'s timetable from "${template.name}" (${created} new, ${updated} re-dated, ${kept} already taught)`,
    meta: { templateId, startDate, created, updated, kept, removed: orphans.length },
  });

  revalidatePath(`/batches/${batchId}`);
  revalidatePath("/students");
  revalidatePath("/coaching");
  revalidatePath("/classroom");
  return {
    ok: true,
    summary: { created, updated, removed: orphans.length, kept, sprintStartYmd: plan.sprintStartYmd },
  };
}

const sessionSchema = z.object({
  title: z.string().trim().min(1, "Give the session a title").max(200),
  framework: z.string().trim().max(120).optional(),
  type: z.enum(["KICKOFF", "COACHING", "LINKEDIN", "QA", "OPEN_MARKET", "LIVE_CLASS", "OTHER"]),
  delivery: z.enum(["LIVE", "PRE_RECORDED"]),
  weekNumber: z.coerce.number().int().min(1).max(104).optional(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().trim().optional(),
  durationMins: z.coerce.number().int().min(0).max(1440).optional(),
  joinUrl: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Add or edit ONE session on a batch's timetable - the per-cohort override.
 *
 * Date and time are separate fields rather than a `datetime-local`, because the batch's clock is
 * IST whoever is typing: the founders work from Chennai and Germany, and a browser-local
 * datetime picker silently records a German evening as a different Indian day.
 */
export async function upsertBatchSession(
  batchId: string,
  sessionId: string | null,
  form: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!(await canManageBatch(session, batchId))) return { ok: false, error: "Not allowed" };

  const raw = Object.fromEntries(form);
  for (const k of ["time", "durationMins", "joinUrl", "notes", "framework", "weekNumber"]) {
    if (typeof raw[k] === "string" && raw[k].trim() === "") delete raw[k];
  }
  const parsed = sessionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  if (d.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) {
    return { ok: false, error: "Start time must be a 24-hour clock time, like 10:30" };
  }

  // A pre-recorded module has a release day but no clock; a live class without a time is
  // stored at IST midnight and shown as "time to be confirmed" rather than as 00:00.
  const timeHm = d.delivery === "PRE_RECORDED" ? null : d.time || null;
  const startsAt = istWallToUtc(d.date, timeHm ?? "00:00");

  const data = {
    title: d.title,
    framework: d.framework || null,
    type: d.type as never,
    delivery: d.delivery as never,
    weekNumber: d.weekNumber ?? null,
    startsAt,
    durationMins: d.durationMins ?? null,
    joinUrl: d.joinUrl || null,
    notes: d.notes || null,
  };

  if (sessionId) {
    const prior = await prisma.classSession.findUnique({ where: { id: sessionId }, select: { batchId: true, title: true } });
    if (!prior || prior.batchId !== batchId) return { ok: false, error: "Session not found" };
    await prisma.classSession.update({ where: { id: sessionId }, data });
  } else {
    const last = await prisma.classSession.findFirst({
      where: { batchId, weekNumber: d.weekNumber ?? null },
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });
    await prisma.classSession.create({
      data: { batchId, orderIndex: (last?.orderIndex ?? -1) + 1, createdById: session.user.id, ...data },
    });
  }

  await logActivity(session, {
    action: sessionId ? "batch.session.update" : "batch.session.create",
    section: "students",
    entityType: "ClassSession",
    entityId: sessionId ?? batchId,
    summary: `${sessionId ? "Updated" : "Scheduled"} "${d.title}" on ${d.date}${timeHm ? ` at ${timeHm}` : ""}`,
    meta: { batchId },
  });

  revalidatePath(`/batches/${batchId}`);
  revalidatePath("/coaching");
  revalidatePath("/classroom");
  return { ok: true };
}

/** Remove one session. Refuses once a register has been taken against it - that is the record
 *  of a class that happened, and nothing on this screen should be able to erase it. */
export async function deleteBatchSession(sessionId: string): Promise<ActionResult> {
  const session = await requireSession();
  const row = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, batchId: true, _count: { select: { attendance: true } } },
  });
  if (!row) return { ok: false, error: "Session not found" };
  if (!(await canManageBatch(session, row.batchId))) return { ok: false, error: "Not allowed" };
  if (row._count.attendance > 0) {
    // Points at the alternative now that there IS one (issue C3). The old wording left somebody
    // holding a class that could neither be deleted nor marked as called off.
    return {
      ok: false,
      error: "That class has a register against it - cancel it instead of deleting it.",
    };
  }

  await prisma.classSession.delete({ where: { id: sessionId } });
  await logActivity(session, {
    action: "batch.session.delete",
    section: "students",
    entityType: "ClassSession",
    entityId: sessionId,
    summary: `Removed the class "${row.title}"`,
    meta: { batchId: row.batchId },
  });
  revalidatePath(`/batches/${row.batchId}`);
  revalidatePath("/coaching");
  revalidatePath("/classroom");
  return { ok: true };
}

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *  CALL A CLASS OFF  (issue C3)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The missing verb. `upsertBatchSession` re-times a class and `deleteBatchSession` removes one,
 * and neither is what happens when a class is cancelled:
 *
 *   · Delete loses the history. The class was scheduled, students were told, and then it was
 *     called off - all three of those are facts, and a deleted row keeps none of them. It also
 *     cascades the register away, which is why delete refuses once one exists.
 *   · Re-timing is a lie when there is no new time yet.
 *
 * So cancelling is a state transition that keeps everything: the row, its register, its tasks,
 * its resources and its place in the week. What changes is that `lib/session-status.ts`'s
 * `SESSION_ON` filter stops matching it, so it leaves every attendance denominator, closes its
 * register, drops its join link and sends no reminder - while staying visible, labelled, on both
 * timetables.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TOUCH ─────────────────────────────────────────────────────
 * The REGISTER. Marks already taken stay exactly as they are, including self check-ins from the
 * ten minutes before the tutor's internet died. Deleting them would be destroying a student's
 * evidence that they turned up, and the attendance rate does not need it gone - the session has
 * left the denominator, so the rows are simply no longer read. If the class is later restored,
 * they are all still there.
 *
 * ── WHY THE STUDENTS ARE TOLD HERE AND NOT BY A CRON ────────────────────────────────────────
 * `notifyCohortOfCancellation` is called inline, after the write, and its failure cannot fail
 * this action. A cancellation is worth nothing if nobody hears it in time, and the one thing
 * worse than a late notice is a cancellation that silently did not save because the notice
 * failed.
 */
const cancelSchema = z.object({
  /** CANCELLED or POSTPONED - see `SessionStatus`. Two different things to tell a student. */
  status: z.enum(["CANCELLED", "POSTPONED"]),
  /** Shown to the cohort verbatim, so it is prose rather than a code. Optional but asked for. */
  reason: z.string().trim().max(500).optional(),
});

export async function cancelBatchSession(sessionId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = cancelSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const row = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, title: true, batchId: true, status: true, startsAt: true, durationMins: true,
      delivery: true,
    },
  });
  if (!row) return { ok: false, error: "Session not found" };
  if (!(await canManageBatch(session, row.batchId))) return { ok: false, error: "Not allowed" };

  /**
   * A PRE_RECORDED module has no clock and no register, so "cancelled" is not a thing that can
   * happen to it - it is either published to the cohort or it is not. Letting it be cancelled
   * would put a struck-through video on a timetable with nothing to explain.
   */
  if (row.delivery === "PRE_RECORDED") {
    return {
      ok: false,
      error: "That one is a recording, not a live class - remove it from the timetable instead.",
    };
  }

  // The window rule lives in lib/session-status.ts so the button and the server agree about
  // which classes offer it - the same reason `checkInState` was extracted.
  const allowed = canCancelSession(row, new Date());
  if (!allowed.ok) return { ok: false, error: allowed.reason };

  await prisma.classSession.update({
    where: { id: sessionId },
    data: {
      status: d.status,
      cancelReason: d.reason?.trim() || null,
      cancelledAt: new Date(),
      cancelledById: session.user.id,
      /**
       * CLOSE THE REGISTER, if one is open.
       *
       * `closesAt = now` rather than nulling both, exactly as closing a window early does
       * elsewhere: the record still says a window existed and when it ended. Without this a
       * cancelled class would keep accepting check-ins for the rest of its window, and
       * `isCheckInOpen` would be telling students to mark themselves present at a class that
       * has been called off.
       */
      ...(row.status === "SCHEDULED" ? { attendanceClosesAt: new Date() } : {}),
    },
  });

  await logActivity(session, {
    action: d.status === "POSTPONED" ? "batch.session.postpone" : "batch.session.cancel",
    section: "students",
    entityType: "ClassSession",
    entityId: sessionId,
    summary: `${d.status === "POSTPONED" ? "Postponed" : "Cancelled"} the class "${row.title}"`,
    meta: { batchId: row.batchId, reason: d.reason?.trim() || null, startsAt: row.startsAt.toISOString() },
  });

  revalidatePath(`/batches/${row.batchId}`);
  revalidatePath("/coaching");
  revalidatePath("/classroom");
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Put a called-off class back on.
 *
 * Needed because cancelling is reversible in a way deleting was not - a class called off at 8am
 * and reinstated at 9am should return with its register, its tasks and its resources intact,
 * which is the whole argument for a state rather than a deletion.
 *
 * The attendance window is NOT reopened. Reinstating says the class is happening; whether the
 * register opens is the tutor's separate decision, and silently re-opening a window that had
 * already closed would let people check in to a class they are not at.
 */
export async function restoreBatchSession(sessionId: string): Promise<ActionResult> {
  const session = await requireSession();
  const row = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, batchId: true, status: true },
  });
  if (!row) return { ok: false, error: "Session not found" };
  if (!(await canManageBatch(session, row.batchId))) return { ok: false, error: "Not allowed" };
  if (sessionIsOn(row.status)) return { ok: false, error: "That class is already on." };

  await prisma.classSession.update({
    where: { id: sessionId },
    data: { status: "SCHEDULED", cancelReason: null, cancelledAt: null, cancelledById: null },
  });

  await logActivity(session, {
    action: "batch.session.restore",
    section: "students",
    entityType: "ClassSession",
    entityId: sessionId,
    summary: `Put the class "${row.title}" back on`,
    meta: { batchId: row.batchId, wasStatus: row.status },
  });

  revalidatePath(`/batches/${row.batchId}`);
  revalidatePath("/coaching");
  revalidatePath("/classroom");
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Post the recording OF a session.
 *
 * Distinct from German Note's `postRecording`, which adds a clip to a batch's classroom and
 * leaves "which class is this a video of" to be inferred from the date. Here the session is the
 * subject: one call creates the `GnRecording` and sets `ClassSession.recordingId`, so the
 * student opens the class they missed and finds its own recording inside it.
 *
 * Agreement §3.3 promises every live session is recorded and made available. Without this the
 * promise had no mechanism on a coaching cohort at all.
 */
export async function postSessionRecording(sessionId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const row = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, batchId: true, startsAt: true, recordingId: true },
  });
  if (!row) return { ok: false, error: "Session not found" };
  if (!(await canManageBatch(session, row.batchId))) return { ok: false, error: "Not allowed" };

  const url = String(form.get("videoUrl") ?? "").trim();
  if (!url) return { ok: false, error: "Paste the recording link" };
  const video = parseVideoUrl(url);
  if (!video) {
    return { ok: false, error: "Paste the Fathom share link (or a YouTube / Vimeo / Google Drive video link)" };
  }

  /**
   * HOW LONG THE STUDENTS MAY WATCH IT - the tutor's or head coach's call, per recording.
   *
   * An absent field falls back to the house default (Console → Attendance), which itself ships
   * at "no limit" so that nothing a cohort was already promised changes by deploying this.
   */
  const rawDays = form.get("accessDays");
  const parsedDays =
    rawDays === null || String(rawDays).trim() === ""
      ? (await getAttendanceConfig()).recordingAccessDays
      : Number(String(rawDays));
  if (!Number.isFinite(parsedDays) || parsedDays < 0 || parsedDays > MAX_RECORDING_ACCESS_DAYS) {
    return { ok: false, error: "Pick how long students may watch this" };
  }
  const postedAt = new Date();

  /**
   * RE-POSTING REPLACES, rather than orphaning.
   *
   * `ClassSession.recordingId` is unique-to-one, so pointing it at a new row left the old
   * recording behind with no session - invisible to every screen, and still counted by nothing.
   * When a head coach corrects a bad link (which is exactly the case the founders described),
   * the honest outcome is that the previous row goes away, taking its watch rows with it by
   * cascade. The watch history of a WRONG video is not evidence of anything.
   */
  const recording = await prisma.gnRecording.create({
    data: {
      batchId: row.batchId,
      title: row.title,
      // The day the class ran, in IST - not today, which is when somebody got round to posting it.
      classDate: parseDateInput(new Date(row.startsAt.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)),
      videoUrl: url,
      provider: video.provider,
      embedUrl: video.embedUrl,
      postedById: session.user.id,
      availableUntil: expiryFor(postedAt, parsedDays),
    },
  });
  await prisma.classSession.update({ where: { id: sessionId }, data: { recordingId: recording.id } });
  if (row.recordingId && row.recordingId !== recording.id) {
    await prisma.gnRecording.delete({ where: { id: row.recordingId } }).catch(() => {
      // A recording also reachable from a WATCH_VIDEO task or a classroom module will refuse to
      // delete. Leaving it is strictly better than failing the replacement the coach asked for.
    });
  }

  await logActivity(session, {
    action: "batch.session.recording",
    section: "students",
    entityType: "ClassSession",
    entityId: sessionId,
    summary: `Posted the recording of "${row.title}"`,
    meta: {
      batchId: row.batchId,
      provider: video.provider,
      replaced: row.recordingId ?? null,
      availableUntil: recording.availableUntil?.toISOString() ?? null,
    },
  });

  revalidatePath(`/batches/${row.batchId}`);
  revalidatePath("/coaching");
  revalidatePath("/classroom");
  revalidatePath("/dashboard");
  // The catch-up list is built from "is there a recording, and how old is it", so posting one
  // changes the Attendance desk.
  revalidatePath("/attendance");
  return { ok: true };
}

/**
 * Change how long an existing recording may be watched, without touching its link.
 *
 * Separate from re-posting because they are different intentions: a head coach extending a
 * window for a student who asked should not have to re-paste a URL, and re-pasting a URL is
 * how you replace a video rather than how you grant more time. The window is always measured
 * from when the recording was POSTED, so extending twice does not compound.
 */
export async function setRecordingWindow(sessionId: string, days: number): Promise<ActionResult> {
  const session = await requireSession();
  const row = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, batchId: true, recordingId: true },
  });
  if (!row) return { ok: false, error: "Session not found" };
  if (!(await canManageBatch(session, row.batchId))) return { ok: false, error: "Not allowed" };
  if (!row.recordingId) return { ok: false, error: "There is no recording on this class yet." };
  if (!Number.isFinite(days) || days < 0 || days > MAX_RECORDING_ACCESS_DAYS) {
    return { ok: false, error: "Pick how long students may watch this" };
  }

  const recording = await prisma.gnRecording.findUnique({
    where: { id: row.recordingId },
    select: { createdAt: true, availableUntil: true },
  });
  if (!recording) return { ok: false, error: "Recording not found" };

  const availableUntil = expiryFor(recording.createdAt, days);
  await prisma.gnRecording.update({ where: { id: row.recordingId }, data: { availableUntil } });

  await logActivity(session, {
    action: "batch.recording.window",
    section: "attendance",
    entityType: "GnRecording",
    entityId: row.recordingId,
    summary:
      availableUntil === null
        ? `Removed the viewing limit on the recording of "${row.title}"`
        : `Students may watch the recording of "${row.title}" for ${days} days`,
    meta: {
      batchId: row.batchId,
      days,
      was: recording.availableUntil?.toISOString() ?? null,
      now: availableUntil?.toISOString() ?? null,
    },
  });

  revalidatePath(`/batches/${row.batchId}`);
  revalidatePath("/attendance");
  revalidatePath("/classroom");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** The sprint start the founders move by hand when a cohort slips. */
export async function setSprintStart(batchId: string, value: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!(await canManageBatch(session, batchId))) return { ok: false, error: "Not allowed" };
  const trimmed = value.trim();
  if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false, error: "Pick a date" };

  const batch = await prisma.batch.update({
    where: { id: batchId },
    data: { sprintStartDate: trimmed ? parseDateInput(trimmed) : null },
    select: { name: true },
  });
  await logActivity(session, {
    action: "batch.sprint.set",
    section: "students",
    entityType: "Batch",
    entityId: batchId,
    summary: trimmed ? `Set ${batch.name}'s sprint to start ${trimmed}` : `Cleared ${batch.name}'s sprint start`,
    meta: { batchId },
  });
  revalidatePath(`/batches/${batchId}`);
  revalidatePath("/classroom");
  return { ok: true };
}
