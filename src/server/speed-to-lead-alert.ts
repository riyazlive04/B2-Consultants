import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import {
  speedToLeadReport,
  shouldAlert,
  alertSubject,
  formatAge,
  formatHitRate,
  type SpeedToLeadLead,
  type SpeedToLeadReport,
} from "@/lib/speed-to-lead";
import { getEmailRuntime, sendResendEmail, brandEmailHeader } from "@/lib/email";
import { getSpeedToLeadAlertConfig } from "./founder-config";
import { logSystemActivity, SYSTEM_ACTORS } from "./activity-log";

/**
 * Speed-to-lead alerting — the engine.
 *
 * The app already GRADES every lead against the JD's response clauses (lib/outreach-sla.ts) and
 * renders the result on the L1 desk. What it has never done is tell anyone when the grade is bad,
 * so a lead going cold is visible only to someone already looking at the screen it's on.
 *
 * This is the cheapest item on the operability list and the one aimed at the number that comes up
 * in every client conversation: 23,435 leads, effectively none contacted.
 *
 * SHAPE:
 *   - Reads only leads inside the configured lookback. Grading the whole table every five minutes
 *     would be both slow and wrong (see the backlog note in lib/speed-to-lead.ts).
 *   - Computes the report ALWAYS, even when the alert is off or email is unarmed, and logs it.
 *     "What would we have sent" has to be answerable before anyone will arm this.
 *   - Sends at most one email per cooldown, whatever the tick rate.
 *   - Never throws into the cron — always resolves a result object.
 */

const LAST_ALERT_KEY = "speedToLeadAlert.lastSentAt";

export type SpeedToLeadRun = {
  enabled: boolean;
  sent: boolean;
  reason?: string;
  breaches: number;
  considered: number;
  hitRate: number | null;
  worstAgeMinutes: number;
  /** The standing backlog — reported, never alerted on. See the module note. */
  uncontactedTotal?: number;
  delivered?: number;
};

/**
 * Loads the alertable slice: leads that opted in inside the lookback.
 *
 * `optInAt` comes from the OutreachJourney when there is one and falls back to `createdAt` — the
 * same baseline `l1-desk-metrics.ts` uses, so the alert and the desk can never disagree about
 * when a lead's clock started.
 */
async function loadRecentLeads(sinceMs: number): Promise<SpeedToLeadLead[]> {
  const since = new Date(sinceMs);
  const rows = await prisma.lead.findMany({
    where: {
      ...ACTIVE,
      // A generous DB-side floor on createdAt; the exact opt-in cut is applied in the pure
      // function, which also handles a journey whose optInAt trails its lead's createdAt.
      createdAt: { gte: new Date(sinceMs - 24 * 60 * 60 * 1000) },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      assignedToId: true,
      assignedTo: { select: { name: true, email: true } },
      outreachJourney: { select: { optInAt: true } },
      // The FIRST connection is what both SLA clocks are judged on — a lead rung at 09:02 and
      // again at 15:00 met the five-minute rule, and taking the latest call would mark it late.
      callLogs: {
        where: { outcome: "SPOKE" },
        orderBy: { calledAt: "asc" },
        take: 1,
        select: { calledAt: true },
      },
    },
    // Bounded. A burst of inbound must not turn the alert into the slowest thing on the tick.
    take: 2000,
    orderBy: { createdAt: "desc" },
  });

  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      optInAt: r.outreachJourney?.optInAt ?? r.createdAt,
      connectedAt: r.callLogs[0]?.calledAt ?? null,
      ownerId: r.assignedToId,
      ownerName: r.assignedTo?.name ?? r.assignedTo?.email ?? null,
    }))
    .filter((l) => l.optInAt.getTime() >= since.getTime());
}

/** The standing backlog: every active lead that has never been connected. Context, not a trigger. */
async function uncontactedTotal(): Promise<number> {
  return prisma.lead.count({
    where: { ...ACTIVE, callLogs: { none: { outcome: "SPOKE" } } },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function alertHtml(report: SpeedToLeadReport, backlog: number, thresholdMinutes: number): string {
  const rows = report.breaches
    .slice(0, 15)
    .map(
      (b) =>
        `<tr>
           <td style="padding:6px 0;color:#16203A">${esc(b.name)}</td>
           <td style="padding:6px 0;color:#4A566E">${esc(b.ownerName ?? "Unassigned")}</td>
           <td style="padding:6px 0;text-align:right;font-weight:600;color:#16203A">${formatAge(b.ageMinutes)}</td>
         </tr>`,
    )
    .join("");

  const more =
    report.breaches.length > 15
      ? `<p style="color:#636F85;font-size:12px;margin:8px 0 0">…and ${report.breaches.length - 15} more.</p>`
      : "";

  const owners = report.byOwner
    .map((o) => `${esc(o.ownerName)} (${o.count})`)
    .join(" · ");

  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">
    ${brandEmailHeader()}
    <p style="font-size:16px;font-weight:700;margin:0 0 4px">
      ${report.breaches.length} lead${report.breaches.length === 1 ? " is" : "s are"} waiting to be called
    </p>
    <p style="color:#636F85;margin:0 0 16px">
      Nobody has connected with ${report.breaches.length === 1 ? "this lead" : "these leads"} and
      ${report.breaches.length === 1 ? "it has" : "the oldest has"} been waiting
      ${formatAge(report.worstAgeMinutes)} — past the ${thresholdMinutes}-minute threshold.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;max-width:520px">
      <tr>
        <th style="text-align:left;padding:0 0 6px;font-size:12px;color:#636F85;font-weight:600">Lead</th>
        <th style="text-align:left;padding:0 0 6px;font-size:12px;color:#636F85;font-weight:600">Owner</th>
        <th style="text-align:right;padding:0 0 6px;font-size:12px;color:#636F85;font-weight:600">Waiting</th>
      </tr>
      ${rows}
    </table>
    ${more}
    <p style="color:#4A566E;margin:18px 0 0">
      Five-minute hit rate on the last ${report.considered} lead${report.considered === 1 ? "" : "s"}:
      <strong>${formatHitRate(report.hitRate)}</strong>${owners ? ` · By owner: ${owners}` : ""}
    </p>
    <p style="color:#636F85;font-size:12px;margin:14px 0 0">
      Separately, <strong>${backlog.toLocaleString("en-IN")}</strong> leads in total have never been
      connected with. That backlog is deliberately not what this alert fires on — it would fire
      forever. Adjust the threshold and recipients in Founder Console → Maintenance.
    </p>
  </div>`;
}

export async function runSpeedToLeadAlert(): Promise<SpeedToLeadRun> {
  const cfg = await getSpeedToLeadAlertConfig();
  const now = new Date();

  const leads = await loadRecentLeads(now.getTime() - cfg.lookbackMinutes * 60_000);
  const report = speedToLeadReport(leads, now, {
    thresholdMinutes: cfg.thresholdMinutes,
    lookbackMinutes: cfg.lookbackMinutes,
  });

  const base: SpeedToLeadRun = {
    enabled: cfg.enabled,
    sent: false,
    breaches: report.breaches.length,
    considered: report.considered,
    hitRate: report.hitRate,
    worstAgeMinutes: report.worstAgeMinutes,
  };

  // The report is computed and returned even when disabled — that is how the founders can see
  // what this WOULD say before turning it on, which is the only honest way to pick a threshold.
  if (!cfg.enabled) return { ...base, reason: "Speed-to-lead alerting is switched off" };
  if (!cfg.recipients.length) return { ...base, reason: "No recipients configured" };
  if (!shouldAlert(report, cfg.minBreaches)) {
    return { ...base, reason: `Below the alert threshold (${cfg.minBreaches} breaches)` };
  }

  const lastRow = await prisma.appSetting.findUnique({ where: { key: LAST_ALERT_KEY } });
  const lastSentAt = typeof lastRow?.value === "string" ? Date.parse(lastRow.value) : NaN;
  if (Number.isFinite(lastSentAt) && now.getTime() - lastSentAt < cfg.cooldownMinutes * 60_000) {
    // A standing problem must not become a per-tick mailstorm. The situation is still true;
    // it just doesn't need saying again yet.
    return { ...base, reason: "Within the cooldown since the last alert" };
  }

  const rt = await getEmailRuntime();
  if (!rt.enabled) {
    // Deliberately NOT stamping the cooldown here. Unlike the scheduled digest (which is tied to
    // a calendar period and would otherwise retry hourly forever), this alert is a live condition:
    // once email is armed, the very next tick should be free to send.
    await logSystemActivity(SYSTEM_ACTORS.alerts, {
      action: "alert.speed-to-lead.skipped",
      section: "outreach",
      entityType: "AppSetting",
      entityId: "speedToLeadAlert",
      summary: `Would have alerted on ${report.breaches.length} waiting lead${report.breaches.length === 1 ? "" : "s"}, but email is ${rt.configured ? "paused" : "not configured"}`,
      meta: { breaches: report.breaches.length, worstAgeMinutes: report.worstAgeMinutes },
    });
    return { ...base, reason: rt.configured ? "Email is paused" : "Email isn't configured" };
  }

  const backlog = await uncontactedTotal();
  const html = alertHtml(report, backlog, cfg.thresholdMinutes);
  const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
  const subject = alertSubject(report);

  let delivered = 0;
  for (const to of cfg.recipients) {
    const res = await sendResendEmail({ apiKey: rt.apiKey!, from, to, subject, html });
    if (res.ok) delivered++;
  }

  // Stamped even if every send failed: a Resend outage should not turn into one alert attempt
  // per tick. The failure itself is visible in the activity log below.
  await prisma.appSetting.upsert({
    where: { key: LAST_ALERT_KEY },
    create: { key: LAST_ALERT_KEY, value: now.toISOString() },
    update: { value: now.toISOString() },
  });

  await logSystemActivity(SYSTEM_ACTORS.alerts, {
    action: "alert.speed-to-lead.send",
    section: "outreach",
    entityType: "AppSetting",
    entityId: "speedToLeadAlert",
    summary: `Alerted ${delivered}/${cfg.recipients.length} recipient${cfg.recipients.length === 1 ? "" : "s"} about ${report.breaches.length} waiting lead${report.breaches.length === 1 ? "" : "s"}`,
    meta: {
      breaches: report.breaches.length,
      worstAgeMinutes: report.worstAgeMinutes,
      considered: report.considered,
      backlog,
    },
  });

  return { ...base, sent: delivered > 0, delivered, uncontactedTotal: backlog };
}
