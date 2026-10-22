import "server-only";
import { prisma } from "@/lib/prisma";
import { AGREEMENT_PROVIDER } from "@/lib/agreement";
import { emailSigningReminder } from "./agreement-email";
import { firstName, parseAgreementData, recordAgreementEvent } from "./agreement-core";
import { getAgreementWorkflow } from "./founder-config";
import { sendWhatsApp } from "./whatsapp";
import { runTimestampSweep } from "./agreement-timestamp";

/**
 * The daily sweep that chases unsigned agreements.
 *
 * ── WHY A SWEEP AND NOT A SCHEDULED JOB PER AGREEMENT ───────────────────────────────────────
 * There is no job queue reachable from here that survives a redeploy, and an agreement's reminder
 * schedule can change under it: the founder can move the days in Console, the student can sign,
 * the link can expire, the founder can void it. A sweep reads the current truth every time and is
 * idempotent, so running it twice in a day sends nothing twice - which is the property that
 * actually matters for a message with the company's name on it.
 *
 * ── HOW "ALREADY NUDGED" IS KNOWN ───────────────────────────────────────────────────────────
 * From the append-only trail, not from a counter on the row. Each send records a DELIVERY_SENT
 * event carrying `{ kind: "AGREEMENT_REMINDER", day }`, and a day that appears there is never
 * sent again. That keeps the only record of outbound contact in one place, and it means a
 * reminder the founder sent by hand is visible to the sweep as well.
 *
 * ── WHAT IT WILL NEVER DO ───────────────────────────────────────────────────────────────────
 * Send a link. Only the token's hash is stored, so there is nothing to rebuild one from; the
 * reminder points at the message already in their chat or inbox. Minting a fresh token to make a
 * prettier reminder would silently break the link they already have.
 */

export type ReminderRun = {
  considered: number;
  nudged: number;
  skipped: number;
  /** Per-agreement detail, for the cron log and the Console's "last run" line. */
  details: string[];
};

export async function runAgreementReminders(): Promise<ReminderRun> {
  const workflow = await getAgreementWorkflow();
  const days = [...workflow.reminderDays].sort((a, b) => a - b);
  if (days.length === 0) {
    return { considered: 0, nudged: 0, skipped: 0, details: ["Automatic reminders are switched off."] };
  }

  const now = new Date();
  const rows = await prisma.agreement.findMany({
    where: {
      // Issued, unsigned, and the link is still alive. An expired link cannot be chased - the
      // agreement has to be voided and cloned, which is the founder's call, not a cron's.
      status: { in: ["SENT", "VIEWED"] },
      signedAt: null,
      issuedAt: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      documentNo: true,
      data: true,
      issuedAt: true,
      expiresAt: true,
      leadId: true,
      studentId: true,
      // Only the reminder events, and only their meta - never the whole trail of every agreement.
      events: {
        where: { type: "DELIVERY_SENT" },
        select: { meta: true },
      },
    },
    take: 200,
  });

  const run: ReminderRun = { considered: rows.length, nudged: 0, skipped: 0, details: [] };

  for (const row of rows) {
    const issuedAt = row.issuedAt!;
    const elapsed = Math.floor((now.getTime() - issuedAt.getTime()) / 86400_000);

    // The LAST day that has come due, so an agreement that slipped past two thresholds (a cron
    // outage, a paused deployment) gets one nudge rather than a burst of them.
    const due = days.filter((d) => d <= elapsed).pop();
    if (due === undefined) {
      run.skipped++;
      continue;
    }
    if (alreadyNudged(row.events, due)) {
      run.skipped++;
      continue;
    }

    const parsed = parseAgreementData(row.data);
    if (!parsed.ok) {
      run.skipped++;
      run.details.push(`${row.documentNo}: skipped, stored fields are invalid`);
      continue;
    }
    const { student } = parsed.data;

    const wantsWhatsApp = workflow.deliverBy !== "EMAIL";
    const wantsEmail = workflow.deliverBy !== "WHATSAPP";

    const whatsapp = wantsWhatsApp
      ? await sendWhatsApp({
          kind: "AGREEMENT_REMINDER",
          to: student.phone,
          vars: { name: firstName(student.fullName), document_no: row.documentNo },
          bodySummary: `Agreement ${row.documentNo} - reminder (day ${due})`,
          agreementId: row.id,
          leadId: row.leadId,
          studentId: row.studentId,
        })
      : null;

    const email =
      wantsEmail && student.email
        ? await emailSigningReminder({
            to: student.email,
            name: student.fullName,
            documentNo: row.documentNo,
            issuedAt,
            expiresAt: row.expiresAt,
          })
        : null;

    const sent = !!whatsapp?.sent || !!email?.sent;

    /**
     * The event is recorded EITHER WAY, and the `day` is what stops a retry.
     *
     * Deliberate: if a send fails because no WATI template is bound and no email is on record, it
     * will fail identically tomorrow, and the day after. Recording the attempt turns that into one
     * visible failure on the trail instead of a message attempted every morning forever. The
     * founder can still nudge by hand, and `delivery-health` surfaces the failure.
     */
    await recordAgreementEvent(row.id, sent ? "DELIVERY_SENT" : "DELIVERY_SKIPPED", {
      meta: {
        kind: "AGREEMENT_REMINDER",
        day: due,
        automatic: true,
        whatsapp: whatsapp ? { sent: whatsapp.sent, error: whatsapp.error ?? null } : null,
        email: email ? { sent: email.sent, error: email.error ?? null } : null,
      },
    });

    if (sent) {
      run.nudged++;
      run.details.push(
        `${row.documentNo}: day ${due} reminder ${[whatsapp?.sent && "WhatsApp", email?.sent && "email"].filter(Boolean).join(" + ")}`,
      );
    } else {
      run.skipped++;
      run.details.push(
        `${row.documentNo}: day ${due} reminder did not send (${whatsapp?.error ?? email?.error ?? "no channel available"})`,
      );
    }
  }

  return run;
}

/** Has this day's nudge already been recorded on the trail? */
function alreadyNudged(events: { meta: unknown }[], day: number): boolean {
  return events.some((e) => {
    if (!e.meta || typeof e.meta !== "object") return false;
    const meta = e.meta as { kind?: unknown; day?: unknown };
    return meta.kind === "AGREEMENT_REMINDER" && meta.day === day;
  });
}

/**
 * The same sweep, as the one-line summary the cron handler logs.
 *
 * `cronRoute` wants a job function; this adapts the richer result into the string a log line and
 * the Console's heartbeat row can carry.
 */
export async function runAgreementRemindersJob(): Promise<{
  ok: true;
  summary: string;
  run: ReminderRun;
  timestamps: Awaited<ReturnType<typeof runTimestampSweep>>;
}> {
  const run = await runAgreementReminders();

  /**
   * The timestamp catch-up rides the same tick.
   *
   * Both are daily sweeps over the agreement table with nothing to say to each other, and a second
   * cron entry is a second thing to remember to schedule on a VPS. Its own key in the payload, so
   * `docker compose logs cron` still shows which of the two did what.
   */
  const timestamps = await runTimestampSweep();

  const stamped = timestamps.configured
    ? `, timestamped ${timestamps.stamped}${timestamps.failed > 0 ? ` (${timestamps.failed} failed)` : ""}`
    : "";
  return {
    ok: true,
    summary: `${AGREEMENT_PROVIDER.entity}: considered ${run.considered}, nudged ${run.nudged}, skipped ${run.skipped}${stamped}`,
    run,
    timestamps,
  };
}
