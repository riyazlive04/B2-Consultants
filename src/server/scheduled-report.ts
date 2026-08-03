import "server-only";
import { prisma } from "@/lib/prisma";
import { istToday, istMinutesOfDay, istWeekRange } from "@/lib/dates";
import { ACTIVE } from "@/lib/soft-delete";
import { aggInrMinor } from "@/lib/money";
import { formatInrMinor } from "@/lib/format";
import { formatHitRate, speedToLeadReport } from "@/lib/speed-to-lead";
import { getScheduledReportConfig } from "./founder-config";
import { getEmailRuntime, sendResendEmail, brandEmailHeader } from "@/lib/email";
import { sendFreeFormMessage } from "./whatsapp";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * The founder digest.
 *
 * This matters more than its size suggests: it is how the app stays in someone's head during a
 * week they never log in. Which is why the upgrade is about READABILITY, not about adding more
 * numbers.
 *
 * THREE CHANGES FROM THE ORIGINAL:
 *
 *  1. DELTAS. Every headline row now carries the same figure for the previous period. A number
 *     with no comparison is not a signal — "₹4,20,000" tells a founder nothing they can act on,
 *     while "₹4,20,000, ▼ 18%" is the whole message.
 *
 *  2. SPEED TO LEAD REPLACES EXPENSES in the headline set. Expenses were already implied by Net,
 *     and the number that actually needs moving is how many leads went uncontacted — the same
 *     number the week-one alerting exists to attack. It belongs in the thing founders read.
 *
 *  3. WHATSAPP, alongside email rather than instead of it. See the config's note on why this is
 *     a session message and what that limits.
 *
 * Still OFF by default (it sends real messages), still a no-op with no recipients, and still
 * guarded by a `scheduledReport.lastSent` AppSetting so it goes out exactly ONCE per period no
 * matter how often the cron ticks. Never throws into the cron.
 */

const LAST_SENT_KEY = "scheduledReport.lastSent";

export type ScheduledReportRun = {
  enabled: boolean;
  sent: boolean;
  reason?: string;
  period?: string;
  recipients?: number;
  delivered?: number;
  whatsappDelivered?: number;
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

type WindowTotals = {
  newLeads: number;
  incomeMinor: bigint;
  netMinor: bigint;
  uncontactedNew: number;
  fiveMinuteHitRate: number | null;
};

const sumRows = (rows: { amountInrMinor: bigint; amountEurMinor: bigint; fxRateUsed: unknown }[]) =>
  rows.reduce((a, r) => a + aggInrMinor(r.amountInrMinor, r.amountEurMinor, r.fxRateUsed as never), 0n);

/**
 * The figures for one window.
 *
 * Run TWICE — once for this period and once for the one before it — so every headline number can
 * be shown against its own history rather than in isolation. Two passes of the same query is the
 * cost of that, and it runs once a week.
 */
async function windowTotals(since: Date, until: Date): Promise<WindowTotals> {
  const [newLeads, incomes, expenses, leadRows] = await Promise.all([
    prisma.lead.count({ where: { ...ACTIVE, createdAt: { gte: since, lt: until } } }),
    prisma.income.findMany({
      where: { ...ACTIVE, date: { gte: since, lt: until } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.expense.findMany({
      where: { ...ACTIVE, date: { gte: since, lt: until } },
      select: { amountInrMinor: true, amountEurMinor: true, fxRateUsed: true },
    }),
    prisma.lead.findMany({
      where: { ...ACTIVE, createdAt: { gte: since, lt: until } },
      select: {
        id: true,
        name: true,
        createdAt: true,
        assignedToId: true,
        outreachJourney: { select: { optInAt: true } },
        callLogs: {
          where: { outcome: "SPOKE" },
          orderBy: { calledAt: "asc" },
          take: 1,
          select: { calledAt: true },
        },
      },
      // Bounded: a digest must never become the slowest query in the app.
      take: 5000,
    }),
  ]);

  const incomeMinor = sumRows(incomes);
  const netMinor = incomeMinor - sumRows(expenses);

  // The SLA verdict is REUSED rather than re-derived here — the digest and the L1 desk must
  // never disagree about what "connected within five minutes" means.
  const report = speedToLeadReport(
    leadRows.map((l) => ({
      id: l.id,
      name: l.name,
      optInAt: l.outreachJourney?.optInAt ?? l.createdAt,
      connectedAt: l.callLogs[0]?.calledAt ?? null,
      ownerId: l.assignedToId,
      ownerName: null,
    })),
    until,
    // The whole window IS the lookback here. This is a report on a period, not a live alert, so
    // the backlog exclusion that shapes the alert deliberately does not apply.
    {
      thresholdMinutes: 0,
      lookbackMinutes: Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 60_000)),
    },
  );

  return {
    newLeads,
    incomeMinor,
    netMinor,
    uncontactedNew: leadRows.filter((l) => l.callLogs.length === 0).length,
    fiveMinuteHitRate: report.hitRate,
  };
}

type Digest = {
  windowDays: number;
  now: WindowTotals;
  prev: WindowTotals;
  /** Point-in-time figures — no meaningful "previous" value, so shown without a delta. */
  receivableMinor: bigint;
  overdueInstalments: number;
  uncontactedTotal: number;
};

async function buildDigest(cadence: "WEEKLY" | "MONTHLY", today: Date): Promise<Digest> {
  const windowDays = cadence === "WEEKLY" ? 7 : 30;
  const dayMs = 86_400_000;
  const until = today;
  const since = new Date(until.getTime() - windowDays * dayMs);
  const prevSince = new Date(since.getTime() - windowDays * dayMs);

  const [now, prev, pending, overdueInstalments, uncontactedTotal] = await Promise.all([
    windowTotals(since, until),
    windowTotals(prevSince, since),
    prisma.pendingPayment.findMany({
      where: { ...ACTIVE },
      select: { totalFeeInrMinor: true, totalFeeEurMinor: true, fxRateUsed: true },
    }),
    prisma.instalment.count({ where: { status: "OVERDUE" } }),
    prisma.lead.count({ where: { ...ACTIVE, callLogs: { none: { outcome: "SPOKE" } } } }),
  ]);

  const receivableMinor = pending.reduce(
    (a, p) => a + aggInrMinor(p.totalFeeInrMinor, p.totalFeeEurMinor, p.fxRateUsed as never),
    0n,
  );

  return { windowDays, now, prev, receivableMinor, overdueInstalments, uncontactedTotal };
}

/**
 * A period-over-period change, as a rendered fragment.
 *
 * `betterWhenUp` is load-bearing: FEWER uncontacted leads is good and more is bad, which is the
 * opposite of revenue. Colouring both the same way would paint the worst row on the digest green.
 */
function delta(
  current: number,
  previous: number,
  betterWhenUp: boolean,
): { text: string; good: boolean | null } {
  if (previous === 0) {
    if (current === 0) return { text: "no change", good: null };
    // "+∞%" is not a fact anyone can use. Say what actually happened.
    return { text: "up from 0", good: betterWhenUp };
  }
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return { text: "no change", good: null };
  const up = pct > 0;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(pct)}%`, good: up === betterWhenUp };
}

function digestHtml(d: Digest, cadence: string): string {
  const row = (label: string, value: string, change?: { text: string; good: boolean | null }) => {
    const colour =
      change === undefined || change.good === null ? "#636F85" : change.good ? "#1F7A4D" : "#B4322A";
    return `<tr>
      <td style="padding:8px 0;color:#4A566E">${label}</td>
      <td style="padding:8px 0;text-align:right;font-weight:600;color:#16203A">${value}</td>
      <td style="padding:8px 0 8px 12px;text-align:right;font-size:12px;color:${colour};white-space:nowrap">${change?.text ?? ""}</td>
    </tr>`;
  };

  const hitRateDelta =
    d.now.fiveMinuteHitRate === null || d.prev.fiveMinuteHitRate === null
      ? undefined
      : delta(
          Math.round(d.now.fiveMinuteHitRate * 100),
          Math.round(d.prev.fiveMinuteHitRate * 100),
          true,
        );

  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
    <p style="font-size:16px;font-weight:700;margin:0 0 4px">Your ${cadence.toLowerCase()} numbers</p>
    <p style="color:#636F85;margin:0 0 16px">
      The last ${d.windowDays} days, against the ${d.windowDays} before them.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;max-width:520px">
      ${row("New leads", String(d.now.newLeads), delta(d.now.newLeads, d.prev.newLeads, true))}
      ${row("Income received", formatInrMinor(d.now.incomeMinor), delta(Number(d.now.incomeMinor), Number(d.prev.incomeMinor), true))}
      ${row("Net", formatInrMinor(d.now.netMinor), delta(Number(d.now.netMinor), Number(d.prev.netMinor), true))}
      ${row("New leads never contacted", String(d.now.uncontactedNew), delta(d.now.uncontactedNew, d.prev.uncontactedNew, false))}
      ${row("Answered within 5 min", formatHitRate(d.now.fiveMinuteHitRate), hitRateDelta)}
      ${row("Open receivables", formatInrMinor(d.receivableMinor))}
      ${row("Overdue instalments", String(d.overdueInstalments))}
    </table>
    <p style="color:#636F85;font-size:12px;margin:20px 0 0">
      ${d.uncontactedTotal.toLocaleString("en-IN")} leads in total have never been contacted.
    </p>
    <p style="color:#636F85;font-size:12px;margin:8px 0 0">
      Sent automatically by your B2 dashboard. Adjust how often it sends and who receives it in
      Founder Console → Maintenance.
    </p>
  </div>`;
}

/** The same digest as plain text, for WhatsApp. Short enough to read on a phone without scrolling. */
function digestText(d: Digest, cadence: string): string {
  const line = (label: string, value: string, change?: { text: string }) =>
    `${label}: ${value}${change?.text ? ` (${change.text})` : ""}`;

  return [
    `*B2 ${cadence.toLowerCase()} numbers* — last ${d.windowDays} days`,
    "",
    line("New leads", String(d.now.newLeads), delta(d.now.newLeads, d.prev.newLeads, true)),
    line("Income", formatInrMinor(d.now.incomeMinor), delta(Number(d.now.incomeMinor), Number(d.prev.incomeMinor), true)),
    line("Net", formatInrMinor(d.now.netMinor), delta(Number(d.now.netMinor), Number(d.prev.netMinor), true)),
    line("Never contacted", String(d.now.uncontactedNew), delta(d.now.uncontactedNew, d.prev.uncontactedNew, false)),
    line("Answered within 5 min", formatHitRate(d.now.fiveMinuteHitRate)),
    line("Open receivables", formatInrMinor(d.receivableMinor)),
    line("Overdue instalments", String(d.overdueInstalments)),
    "",
    `${d.uncontactedTotal.toLocaleString("en-IN")} leads have never been contacted.`,
  ].join("\n");
}

export async function runScheduledReport(): Promise<ScheduledReportRun> {
  const cfg = await getScheduledReportConfig();
  if (!cfg.enabled) return { enabled: false, sent: false, reason: "Scheduled report is switched off" };
  if (!cfg.recipients.length && !cfg.whatsappRecipients.length) {
    return { enabled: true, sent: false, reason: "No recipients configured" };
  }

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
  // WhatsApp can still carry the digest when email is unarmed, so this early return only fires
  // when there is genuinely no way to deliver anything.
  if (!rt.enabled && !cfg.whatsappRecipients.length) {
    // Record the period anyway so a mis-configured week doesn't retry every hour, but say why.
    await prisma.appSetting.upsert({
      where: { key: LAST_SENT_KEY },
      create: { key: LAST_SENT_KEY, value: period },
      update: { value: period },
    });
    return {
      enabled: true,
      sent: false,
      period,
      reason: rt.configured ? "Email is paused" : "Email isn't configured",
    };
  }

  const digest = await buildDigest(cfg.cadence, today);
  const subject = `B2 ${cfg.cadence === "WEEKLY" ? "weekly" : "monthly"} numbers`;

  let delivered = 0;
  if (rt.enabled) {
    const html = digestHtml(digest, cfg.cadence);
    const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
    for (const to of cfg.recipients) {
      const res = await sendResendEmail({ apiKey: rt.apiKey!, from, to, subject, html });
      if (res.ok) delivered++;
    }
  }

  let whatsappDelivered = 0;
  if (cfg.whatsappRecipients.length) {
    const text = digestText(digest, cfg.cadence);
    for (const number of cfg.whatsappRecipients) {
      // Session message — lands only inside a 24-hour window opened by the recipient messaging
      // the business. A SKIPPED result is expected and is NOT treated as a failure; email stays
      // the reliable path, which is why this never replaces it.
      const res = await sendFreeFormMessage(number, text, null);
      if (res.sent) whatsappDelivered++;
    }
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
    summary:
      `Sent the ${cfg.cadence.toLowerCase()} founder digest to ${delivered}/${cfg.recipients.length} inbox${cfg.recipients.length === 1 ? "" : "es"}` +
      (cfg.whatsappRecipients.length
        ? ` and ${whatsappDelivered}/${cfg.whatsappRecipients.length} WhatsApp number${cfg.whatsappRecipients.length === 1 ? "" : "s"}`
        : ""),
    meta: { period, delivered, whatsappDelivered, recipients: cfg.recipients.length },
  });

  return {
    enabled: true,
    sent: delivered + whatsappDelivered > 0,
    period,
    recipients: cfg.recipients.length,
    delivered,
    whatsappDelivered,
  };
}
