import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday, istMinutesOfDay, istWeekRange } from "@/lib/dates";
import { ACTIVE } from "@/lib/soft-delete";
import { aggInrMinor } from "@/lib/money";
import { formatInrMinor } from "@/lib/format";
import { getScheduledReportConfig } from "./founder-config";
import { getEmailRuntime, sendResendEmail, brandEmailHeader } from "@/lib/email";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * Scheduled founder digest (audit §C #24).
 *
 * The app could already SEND email (Resend, lib/email.ts) but never emailed the founder the
 * numbers on a cadence — reports were a live pivot you had to open. This assembles a compact
 * digest and delivers it on the configured day/time via the exact same Resend seam every other
 * system email uses.
 *
 * OFF by default (it sends real mail) and a no-op with no recipients. Fired from the daily cron;
 * guarded by a `scheduledReport.lastSent` AppSetting so it goes out exactly ONCE per period no
 * matter how often the cron ticks. Never throws into the cron — always resolves a result.
 */

const LAST_SENT_KEY = "scheduledReport.lastSent";

export type ScheduledReportRun = {
  enabled: boolean;
  sent: boolean;
  reason?: string;
  period?: string;
  recipients?: number;
  delivered?: number;
};

/** ISO weekday 1..7 (Mon..Sun) for an IST-midnight date. */
function isoWeekday(d: Date): number {
  return ((d.getUTCDay() + 6) % 7) + 1;
}

/** The key that identifies "this period", so we send once per week/month. */
function periodKeyFor(cadence: "WEEKLY" | "MONTHLY", today: Date): string {
  if (cadence === "MONTHLY") return today.toISOString().slice(0, 7); // YYYY-MM
  return istWeekRange(today).start.toISOString().slice(0, 10); // Monday's date
}

async function buildDigest(cadence: "WEEKLY" | "MONTHLY", today: Date) {
  const windowDays = cadence === "WEEKLY" ? 7 : 30;
  const since = new Date(today.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [newLeads, incomes, expenses, pending, overdueInstalments] = await Promise.all([
    prisma.lead.count({ where: { ...ACTIVE, createdAt: { gte: since } } }),
    prisma.income.findMany({
      where: { ...ACTIVE, date: { gte: since } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.expense.findMany({
      where: { ...ACTIVE, date: { gte: since } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.pendingPayment.findMany({
      where: { ...ACTIVE },
      select: { totalFeeInrMinor: true, totalFeeEurMinor: true, fxRateUsed: true },
    }),
    prisma.instalment.count({ where: { status: "OVERDUE" } }),
  ]);

  const sum = (rows: { amountInrMinor: bigint; amountEurMinor: bigint; fxRateUsed: unknown }[]) =>
    rows.reduce((a, r) => a + aggInrMinor(r.amountInrMinor, r.amountEurMinor, r.fxRateUsed as never), 0n);

  const incomeMinor = sum(incomes);
  const expenseMinor = sum(expenses);
  const netMinor = incomeMinor - expenseMinor;
  const receivableMinor = pending.reduce(
    (a, p) => a + aggInrMinor(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed as never),
    0n,
  );

  return {
    windowDays,
    newLeads,
    incomeMinor,
    expenseMinor,
    netMinor,
    receivableMinor,
    overdueInstalments,
  };
}

function digestHtml(d: Awaited<ReturnType<typeof buildDigest>>, cadence: string): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 0;color:#4A566E">${label}</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#16203A">${value}</td></tr>`;
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
    <p style="font-size:16px;font-weight:700;margin:0 0 4px">Your ${cadence.toLowerCase()} numbers</p>
    <p style="color:#636F85;margin:0 0 16px">The last ${d.windowDays} days at a glance.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;max-width:460px">
      ${row("New leads", String(d.newLeads))}
      ${row("Income received", formatInrMinor(d.incomeMinor))}
      ${row("Expenses", formatInrMinor(d.expenseMinor))}
      ${row("Net", formatInrMinor(d.netMinor))}
      ${row("Open receivables", formatInrMinor(d.receivableMinor))}
      ${row("Overdue instalments", String(d.overdueInstalments))}
    </table>
    <p style="color:#636F85;font-size:12px;margin:20px 0 0">Sent automatically by your B2 dashboard. Adjust cadence and recipients in Founder Console → Maintenance.</p>
  </div>`;
}

export async function runScheduledReport(): Promise<ScheduledReportRun> {
  const cfg = await getScheduledReportConfig();
  if (!cfg.enabled) return { enabled: false, sent: false, reason: "Scheduled report is switched off" };
  if (!cfg.recipients.length) return { enabled: true, sent: false, reason: "No recipients configured" };

  const today = istToday();
  const dueToday =
    cfg.cadence === "WEEKLY" ? isoWeekday(today) === cfg.weekday : today.getUTCDate() === cfg.monthday;
  if (!dueToday) return { enabled: true, sent: false, reason: "Not the scheduled day" };
  if (istMinutesOfDay(new Date()) < cfg.sendAtMinutes) {
    return { enabled: true, sent: false, reason: "Before the scheduled send time" };
  }

  const period = periodKeyFor(cfg.cadence, today);
  const lastSentRow = await prisma.appSetting.findUnique({ where: { key: LAST_SENT_KEY } });
  if (lastSentRow?.value === period) {
    return { enabled: true, sent: false, period, reason: "Already sent this period" };
  }

  const rt = await getEmailRuntime();
  if (!rt.enabled) {
    // Record the period anyway so a mis-configured week doesn't retry every hour, but say why.
    await prisma.appSetting.upsert({
      where: { key: LAST_SENT_KEY },
      create: { key: LAST_SENT_KEY, value: period },
      update: { value: period },
    });
    return { enabled: true, sent: false, period, reason: rt.configured ? "Email is paused" : "Email isn't configured" };
  }

  const digest = await buildDigest(cfg.cadence, today);
  const html = digestHtml(digest, cfg.cadence);
  const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
  const subject = `B2 ${cfg.cadence === "WEEKLY" ? "weekly" : "monthly"} numbers`;

  let delivered = 0;
  for (const to of cfg.recipients) {
    const res = await sendResendEmail({ apiKey: rt.apiKey!, from, to, subject, html });
    if (res.ok) delivered++;
  }

  await prisma.appSetting.upsert({
    where: { key: LAST_SENT_KEY },
    create: { key: LAST_SENT_KEY, value: period },
    update: { value: period },
  });

  await logSystemActivity(SYSTEM_ACTORS.automation, {
    action: "report.scheduled.send",
    section: "reports",
    entityType: "AppSetting",
    entityId: "scheduledReport",
    summary: `Sent the ${cfg.cadence.toLowerCase()} founder digest to ${delivered}/${cfg.recipients.length} recipient${cfg.recipients.length === 1 ? "" : "s"}`,
    meta: { period, delivered, recipients: cfg.recipients.length },
  });

  return { enabled: true, sent: delivered > 0, period, recipients: cfg.recipients.length, delivered };
}
