import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";
import { formatDate, formatInrMinor } from "@/lib/format";
import { getPendingRows } from "./finance-metrics";
import { sendEmailMessage } from "./messaging";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * Automatic email reminders for instalments falling due (§8.3).
 *
 * Due dates existed in the app but nothing ever acted on them: chasing a payment meant a human
 * noticing the row had gone red. WhatsApp reminders already had an engine; email did not, so a
 * student without a usable WhatsApp number was simply never chased.
 *
 * GATING — fail-closed, deliberately. `sendEmailMessage` no-ops unless EMAIL_ENABLED is set,
 * Resend is configured and email isn't paused; when it's off, this still runs and still logs a
 * SKIPPED Message row, so the founder can see exactly who WOULD have been mailed before arming
 * it. Nothing is sent by accident.
 *
 * DEDUPE — the Message table is the memory. A recipient who was mailed inside the cooldown is
 * skipped, so re-running the cron (or running it every hour) can never turn into a mailbox
 * flood. That matters more than precision here: the cost of a missed nudge is a day's delay,
 * the cost of a duplicate is the founder's credibility with a paying student.
 */

/** Stable, human-readable, and the dedupe key — do not reword without reading `alreadyNudged`. */
const SUBJECT_PREFIX = "Payment reminder";
const COOLDOWN_HOURS = 72;
const DUE_SOON_DAYS = 3;

export type PaymentEmailRun = {
  enabled: boolean;
  ranAt: string;
  /** Receivables that matched the due/overdue window and had an email address. */
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  noEmail: number;
};

export async function runPaymentDueEmails(): Promise<PaymentEmailRun> {
  const ranAt = new Date().toISOString();
  const run: PaymentEmailRun = {
    enabled: true, ranAt, candidates: 0, sent: 0, skipped: 0, failed: 0, noEmail: 0,
  };

  const today = istToday();
  const soon = new Date(today.getTime() + DUE_SOON_DAYS * 86400000);
  const rows = await getPendingRows();

  // Due within the window, or already past it. A row with no due date can't be chased on time.
  const due = rows.filter(
    (p) =>
      (p.status === "ACTIVE" || p.status === "OVERDUE") &&
      p.balance.inr > 0 &&
      p.nextDueDate !== null &&
      new Date(p.nextDueDate) < soon,
  );
  if (due.length === 0) return run;

  const studentIds = due.map((p) => p.studentId).filter((id): id is string => !!id);
  const students = studentIds.length
    ? await prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, email: true, fullName: true, code: true },
      })
    : [];
  const byId = new Map(students.map((s) => [s.id, s]));

  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600000);

  for (const p of due) {
    const student = p.studentId ? byId.get(p.studentId) : undefined;
    const to = student?.email?.trim();
    if (!student || !to) {
      // Not a failure — most receivables simply predate having an email on file.
      run.noEmail++;
      continue;
    }
    run.candidates++;

    const alreadyNudged = await prisma.message.findFirst({
      where: {
        channel: "EMAIL",
        direction: "OUTBOUND",
        toAddress: to,
        subject: { startsWith: SUBJECT_PREFIX },
        createdAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (alreadyNudged) {
      run.skipped++;
      continue;
    }

    const dueDate = new Date(p.nextDueDate!);
    const overdue = dueDate < today;
    const amount = formatInrMinor(p.balance.inr);
    const subject = overdue
      ? `${SUBJECT_PREFIX} — ${amount} was due on ${formatDate(dueDate)}`
      : `${SUBJECT_PREFIX} — ${amount} due on ${formatDate(dueDate)}`;

    const body = [
      `Hi ${student.fullName.split(" ")[0]},`,
      "",
      overdue
        ? `This is a gentle reminder that ${amount} was due on ${formatDate(dueDate)} and is still outstanding.`
        : `This is a gentle reminder that ${amount} is due on ${formatDate(dueDate)}.`,
      "",
      `Student ID: ${student.code ?? "—"}`,
      `Outstanding balance: ${amount}`,
      "",
      "If you have already paid, please ignore this message — and do let us know so we can update our records.",
      "",
      "Thank you,",
      "B2 Consultants",
    ].join("\n");

    const out = await sendEmailMessage({ to, subject, body });
    if (out.status === "SENT") {
      run.sent++;
      await logSystemActivity(SYSTEM_ACTORS.reminders, {
        action: "email.send",
        section: "finance",
        entityType: "PendingPayment",
        entityId: p.id,
        summary: `Emailed ${student.fullName} a ${overdue ? "overdue" : "due"} payment reminder (${amount})`,
        meta: { to, overdue, dueDate: dueDate.toISOString() },
      });
    } else if (out.status === "FAILED") {
      run.failed++;
    } else {
      // SKIPPED — email is off or paused. Logged as a Message row so it's still auditable.
      run.skipped++;
      run.enabled = false;
    }
  }

  return run;
}
