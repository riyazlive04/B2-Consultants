import "server-only";
import type { WhatsAppKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getWatiRuntime } from "@/lib/wati";
import { classReminderRung, formatClassTime, leadLabel, maxLeadMs } from "@/lib/class-reminder";
import { WHATSAPP_KIND_LABELS } from "@/lib/whatsapp";
import { sendWhatsApp, type SendOutcome } from "./whatsapp";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * CLASS REMINDERS - "your class starts in an hour, here is the link".
 *
 * Runs on the same cron tick as the rest of the outbound cadence (`/api/cron/whatsapp`), beside
 * `runDueReminders` rather than inside it: that function is already 400 lines of six touchpoints
 * sharing one budget, and a class reminder is the first one that fans out to a ROOM rather than
 * to one person. Keeping it separate means a bug here cannot stop a payment reminder going out.
 *
 * ── Idempotence, which is the whole problem ─────────────────────────────────────────────
 * A duplicate payment reminder annoys one person. A duplicate class reminder messages an entire
 * cohort twice, and the cron ticks every few minutes - so "have we already told them" has to be
 * answered from durable state, not from memory. It is answered from `WhatsAppMessage` itself:
 * the rows carrying this class's id ARE the record of what was sent, which is the same source
 * the WhatsApp screen shows. A separate `class_reminder` table would have been a second record
 * of the same fact, free to disagree with the first.
 *
 * ── Why it ships off, and rehearsing when armed ─────────────────────────────────────────
 * `classReminderEnabled` defaults false and `classReminderDryRun` defaults true. This is the
 * only touchpoint whose blast radius is "every student in the batch, per class, forever", and
 * the live WATI account sends to real numbers (there is no test recipient set). A dry run writes
 * the full SKIPPED row - recipient, template, resolved text - so the exact blast can be read
 * before one real message leaves.
 */

export type ClassReminderRun = {
  enabled: boolean;
  reason?: string;
  ranAt: string;
  /** Classes inspected in this tick. */
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  /** True when nothing was really sent because the engine is rehearsing. */
  dryRun: boolean;
};

const empty = (over: Partial<ClassReminderRun>): ClassReminderRun => ({
  enabled: false,
  ranAt: new Date().toISOString(),
  considered: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  dryRun: true,
  ...over,
});

/** First name only - a reminder that opens "Hi Priya Raman," reads like a letter from a bank. */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full.trim();
}

export async function runClassReminders(): Promise<ClassReminderRun> {
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
  const toStudents = cadence.classReminderEnabled;
  const toCoach = cadence.classReminderCoachEnabled;
  if (!toStudents && !toCoach) {
    return empty({ ranAt, reason: "Class reminders are switched off in Cadence" });
  }

  const ladder = cadence.classReminderLeadMinutes;
  const lookAhead = maxLeadMs(ladder);
  if (lookAhead === 0) {
    return empty({ ranAt, reason: "No class-reminder lead times are set" });
  }

  // A touchpoint with no template bound would otherwise write a SKIPPED row per student per
  // tick - the same per-candidate spam `runDueReminders` avoids with its own `hasTemplate`.
  const hasTemplate = (kind: WhatsAppKind) => !!runtime.settings.templates[kind]?.name;
  const studentsOn = toStudents && hasTemplate("CLASS_REMINDER");
  const coachOn = toCoach && hasTemplate("CLASS_REMINDER_COACH");
  if (!studentsOn && !coachOn) {
    return empty({ ranAt, reason: "No class-reminder template is bound in WhatsApp → Settings" });
  }

  const dryRun = cadence.classReminderDryRun;
  const now = new Date();

  const sessions = await prisma.classSession.findMany({
    where: {
      delivery: "LIVE",
      startsAt: { gt: now, lte: new Date(now.getTime() + lookAhead) },
      // An archived cohort is finished. Its calendar may still hold future-dated rows from a
      // timetable that was never cleaned up, and nobody should hear from those.
      batch: { status: "ACTIVE" },
    },
    orderBy: { startsAt: "asc" },
    take: 100,
    select: {
      id: true,
      title: true,
      startsAt: true,
      durationMins: true,
      joinUrl: true,
      delivery: true,
      batch: {
        select: {
          id: true,
          name: true,
          tutor: { select: { id: true, name: true, teamProfile: { select: { phone: true } } } },
          members: { select: { student: { select: { id: true, fullName: true, phone: true } } } },
          enrollments: {
            where: { status: "ACTIVE" },
            select: { student: { select: { id: true, fullName: true, phone: true } } },
          },
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  // One safety cap for the whole engine, shared with the rest of the cadence's intent: a
  // mis-set ladder on a big cohort should run out of budget, not out of someone's WhatsApp
  // quality rating.
  let budget = Math.max(0, cadence.maxPerRun);

  const tally = (out: SendOutcome) => {
    if (out.sent) { sent++; budget--; }
    else if (out.status === "FAILED") { failed++; budget--; }
    else skipped++;
  };

  for (const s of sessions) {
    if (budget <= 0) break;

    // Both seating routes, de-duplicated. A student could in principle hold a BatchMember row
    // AND an Enrollment in the same cohort, and that must not mean two reminders.
    const roster = new Map<string, { id: string; fullName: string; phone: string | null }>();
    for (const m of s.batch.members) roster.set(m.student.id, m.student);
    for (const e of s.batch.enrollments) roster.set(e.student.id, e.student);

    const classTime = formatClassTime(s.startsAt);
    const headcount = String(roster.size);

    if (studentsOn && roster.size > 0) {
      /**
       * Every class reminder already sent for THIS class, grouped by student. One read per
       * class rather than one per student: a batch of eight would otherwise cost eight queries
       * per class per tick, and the rows are tiny.
       */
      const priorRows = await prisma.whatsAppMessage.findMany({
        where: { classSessionId: s.id, kind: "CLASS_REMINDER", direction: "OUTBOUND" },
        select: { studentId: true, createdAt: true },
      });
      const priorBy = new Map<string, Date[]>();
      for (const r of priorRows) {
        if (!r.studentId) continue;
        const list = priorBy.get(r.studentId) ?? [];
        list.push(r.createdAt);
        priorBy.set(r.studentId, list);
      }

      for (const student of roster.values()) {
        if (budget <= 0) break;
        const attempts = priorBy.get(student.id) ?? [];
        const rung = classReminderRung(s, ladder, now, attempts);
        if (rung === null) continue;

        tally(
          await sendWhatsApp({
            kind: "CLASS_REMINDER",
            to: student.phone,
            studentId: student.id,
            classSessionId: s.id,
            runtime,
            dryRun,
            vars: {
              name: firstName(student.fullName),
              class_title: s.title,
              class_time: classTime,
              join_url: s.joinUrl ?? "",
            },
            bodySummary: `${s.title} - ${leadLabel(rung)}`,
          }),
        );
      }
    }

    if (coachOn && s.batch.tutor) {
      if (budget <= 0) break;
      const coach = s.batch.tutor;
      const prior = await prisma.whatsAppMessage.findMany({
        where: { classSessionId: s.id, kind: "CLASS_REMINDER_COACH", direction: "OUTBOUND" },
        select: { createdAt: true },
      });
      const rung = classReminderRung(s, ladder, now, prior.map((p) => p.createdAt));
      if (rung !== null) {
        const out = await sendWhatsApp({
          kind: "CLASS_REMINDER_COACH",
          // The coach's number lives on their TeamProfile, not on `User` - the account carries
          // the login, the profile carries the person. No profile means no number, and the send
          // skips with that reason rather than guessing one.
          to: coach.teamProfile?.phone ?? null,
          classSessionId: s.id,
          runtime,
          dryRun,
          vars: {
            name: firstName(coach.name),
            class_title: s.title,
            class_time: classTime,
            batch_name: s.batch.name,
            student_count: headcount,
            join_url: s.joinUrl ?? "",
          },
          bodySummary: `${s.batch.name}: ${s.title} - ${leadLabel(rung)}`,
        });
        tally(out);
        if (out.sent) {
          await logSystemActivity(SYSTEM_ACTORS.reminders, {
            action: "whatsapp.send",
            section: "coaching",
            entityType: "ClassSession",
            entityId: s.id,
            summary: `Sent ${coach.name} the ${WHATSAPP_KIND_LABELS.CLASS_REMINDER_COACH} for ${s.batch.name}`,
            meta: { kind: "CLASS_REMINDER_COACH", classSessionId: s.id, leadMinutes: rung },
          });
        }
      }
    }
  }

  return {
    enabled: true,
    ranAt,
    considered: sessions.length,
    sent,
    skipped,
    failed,
    dryRun,
  };
}
