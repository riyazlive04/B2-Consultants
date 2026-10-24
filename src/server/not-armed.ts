import "server-only";
import { prisma } from "@/lib/prisma";
import { getEmailRuntime } from "@/lib/email";
import { getAgreementWorkflow } from "./founder-config";
import { getWatiRuntime } from "@/lib/wati";
import {
  getBookingCalendars,
  getMaintenanceConfig,
  getFinancePostingConfig,
  getSpeedToLeadAlertConfig,
  getDunningConfig,
  getPipelineConfig,
  getBookingRulesConfig,
} from "./founder-config";
import { readDeliveryStatuses } from "./intake-route";
import { ENGINES, type EngineKey } from "@/lib/engines";

/**
 * "What is built, switched off, and silently doing nothing?"
 *
 * ── The problem this is the structural fix for ──────────────────────────────────
 * This app ships almost every feature OFF by default, which is the right default for anything
 * that spends money or messages a customer. What was missing is any single place that SAYS SO.
 * The result, on production, 4 Aug 2026:
 *
 *   · no availability pattern    → 0 slots, 0 bookings, an empty public /book calendar, and a
 *                                  Bookings page showing four zeroes with no explanation. This
 *                                  is the entirety of "the booking section feels broken".
 *   · EMAIL_ENABLED=false        → password resets, invoices, dunning and the opt-in alert all
 *                                  silently did nothing for months.
 *   · every accrual off          → finance postings that exist and never post.
 *
 * Each of those looked like a bug from the outside. None of them was. A feature that is built,
 * off, and unmentioned is indistinguishable from a feature that is broken - so this makes the
 * distinction visible, once, in one list.
 *
 * ── The contract ────────────────────────────────────────────────────────────────
 * Every item names WHERE to turn it on and WHAT STAYS BROKEN until someone does. An entry that
 * only reported a boolean would be a status light; the point is to be a to-do list.
 */

export type NotArmedItem = {
  key: EngineKey;
  name: string;
  /** True = working. The panel sorts these last and greys them. */
  armed: boolean;
  /** What is NOT happening while this is off. The reason to care. */
  consequence: string;
  /** Exactly where to switch it on. */
  where: string;
  /** Set when the switch is an env var / deploy concern rather than an in-app toggle. */
  needsDeploy?: boolean;
};

export async function getNotArmedReport(): Promise<NotArmedItem[]> {
  const [
    email,
    wati,
    slots,
    maintenance,
    posting,
    speedToLead,
    dunning,
    pipeline,
    deliveries,
    heartbeat,
    bookingRules,
    agreementWorkflow,
  ] =
    await Promise.all([
      getEmailRuntime(),
      getWatiRuntime(),
      getBookingCalendars(),
      getMaintenanceConfig(),
      getFinancePostingConfig(),
      getSpeedToLeadAlertConfig(),
      getDunningConfig(),
      getPipelineConfig(),
      readDeliveryStatuses(),
      prisma.appSetting.findUnique({ where: { key: "cronHeartbeat" } }),
      getBookingRulesConfig(),
      getAgreementWorkflow(),
    ]);

  /**
   * The cron is upstream of most of the rest: dunning, the outreach ladder, the slot top-up and
   * the digests all run from it, so "nothing is happening" usually resolves to this one line.
   * A heartbeat older than two hours means the scheduler is not ticking, whatever the config says.
   */
  const beatAt = (() => {
    // recordCronRun() writes a MAP of job -> { lastRunAt, lastOkAt, consecutiveFailures,
    // lastError } (src/server/uptime.ts). It has never written a top-level `at` key, so the
    // older read of one made this row permanently NOT ARMED with "the scheduler has never
    // ticked" - an always-red light is exactly as uninformative as an always-green one.
    // The newest lastRunAt across all jobs is the liveness signal: any job ticking at all
    // proves the scheduler is alive, which is the only question this row asks.
    const v = heartbeat?.value;
    if (!v || typeof v !== "object") return null;
    let newest: number | null = null;
    for (const entry of Object.values(v as Record<string, unknown>)) {
      const raw = entry && typeof entry === "object" ? (entry as { lastRunAt?: unknown }).lastRunAt : null;
      if (typeof raw !== "string") continue;
      const t = new Date(raw).getTime();
      if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
    }
    return newest === null ? null : new Date(newest);
  })();
  const cronAlive = Boolean(beatAt && Date.now() - beatAt.getTime() < 2 * 60 * 60 * 1000);

  const anyDelivery = Object.values(deliveries).some((d) => d.at);

  const items: NotArmedItem[] = [
    {
      key: "cron",
      name: ENGINES.cron.name,
      armed: cronAlive,
      consequence: ENGINES.cron.consequence,
      where: beatAt
        ? `Last tick ${beatAt.toISOString()} - the scheduler has stopped. Check the cron container / task.`
        : "The scheduler has never ticked. Check the cron sidecar and CRON_SECRET.",
      needsDeploy: true,
    },
    {
      key: "availability",
      name: ENGINES.availability.name,
      // Armed when at least ONE calendar can actually produce a slot. Asking whether *every*
      // calendar is on would light this warning for a deliberately paused one; asking whether
      // any exists at all would call a switched-off list armed.
      armed: slots.some((c) => c.enabled && c.weekdays.length > 0),
      consequence: ENGINES.availability.consequence,
      where: "Console → Sales ops → Availability",
    },
    {
      key: "email",
      name: ENGINES.email.name,
      armed: email.enabled,
      consequence: ENGINES.email.consequence,
      where: email.envEnabled
        ? email.configured
          ? "Sending is paused - Conversations → Settings"
          : "Set RESEND_API_KEY and save a verified From address at Conversations → Settings"
        : 'Set EMAIL_ENABLED="true" and RESEND_API_KEY, then save a From address at Conversations → Settings',
      needsDeploy: !email.envEnabled || !email.apiKey,
    },
    {
      key: "whatsapp",
      name: ENGINES.whatsapp.name,
      armed: wati.enabled,
      consequence: ENGINES.whatsapp.consequence,
      where: wati.envEnabled
        ? "Sending is paused or unconfigured - /whatsapp"
        : 'Set WATI_ENABLED="true" with the endpoint and token',
      needsDeploy: !wati.envEnabled,
    },
    {
      /**
       * Off by DEFAULT and deliberately so - it cancels real bookings - which is exactly the
       * shape of switch this list exists for: built, inert, and indistinguishable from broken
       * to anyone waiting for an unanswered slot to be released.
       */
      key: "confirmLoop",
      name: ENGINES.confirmLoop.name,
      armed: bookingRules.autoCancelEnabled,
      consequence: ENGINES.confirmLoop.consequence,
      where: "Console → Sales ops → Confirm-or-cancel (also WhatsApp → Settings, or Bookings → Manage availability)",
    },
    {
      /**
       * The ONLY message the app sends on enrolment. It belongs on this panel because "built
       * but switched off" is precisely what the panel is for - and because the consequence of
       * leaving it off is silence at the moment somebody has just paid, which no other screen
       * in the app would ever surface.
       */
      key: "studentWelcome",
      name: ENGINES.studentWelcome.name,
      armed: wati.settings.cadence.studentWelcomeEnabled,
      consequence: ENGINES.studentWelcome.consequence,
      where: "WhatsApp → Settings → Enrolment welcome (bind b2_student_welcome first)",
    },
    {
      /**
       * Here for the same reason as the welcome above - built, and switched off by default.
       *
       * Counted as armed only when it is BOTH enabled and sending for real. A rehearsing engine
       * is doing its job perfectly and still nobody is being reminded of anything, which is the
       * exact state this panel exists to make visible rather than let someone discover from a
       * student who missed a class.
       */
      key: "classReminders",
      name: ENGINES.classReminders.name,
      armed: wati.settings.cadence.classReminderEnabled && !wati.settings.cadence.classReminderDryRun,
      consequence: ENGINES.classReminders.consequence,
      where: wati.settings.cadence.classReminderEnabled
        ? "WhatsApp → Settings → Class reminder - switch on “Send for real” (it is rehearsing)"
        : "WhatsApp → Settings → Class reminder (bind b2_class_reminder first)",
    },
    {
      key: "intake",
      name: ENGINES.intake.name,
      armed: anyDelivery,
      consequence: ENGINES.intake.consequence,
      where: "Point Pabbly (or the landing page) at /api/intake/lead with INTAKE_WEBHOOK_SECRET",
    },
    {
      key: "speedToLead",
      name: ENGINES.speedToLead.name,
      armed: speedToLead.enabled,
      consequence: ENGINES.speedToLead.consequence,
      where: "Console → System → Alerts & Chasing",
    },
    {
      key: "dunning",
      name: ENGINES.dunning.name,
      armed: dunning.enabled,
      consequence: ENGINES.dunning.consequence,
      where: "Console → System → Alerts & Chasing",
    },
    {
      /**
       * An unsigned agreement is the most expensive thing in this app to leave sitting: the deal
       * is agreed, the contract is out, and nothing happens until somebody remembers to chase it
       * by hand. With no reminder day switched on, nobody is chased - which looks exactly like a
       * client who is thinking about it.
       */
      key: "agreementReminders",
      name: ENGINES.agreementReminders.name,
      armed: agreementWorkflow.reminderDays.length > 0,
      consequence: ENGINES.agreementReminders.consequence,
      where: "Console → Agreements → Chase an unsigned agreement",
    },
    {
      key: "retention",
      name: ENGINES.retention.name,
      armed: maintenance.retention.enabled,
      consequence: ENGINES.retention.consequence,
      where: "Console → System → Maintenance",
    },
    {
      key: "commissionAccrual",
      name: ENGINES.commissionAccrual.name,
      armed: posting.commissionAccrual.enabled,
      consequence: ENGINES.commissionAccrual.consequence,
      where: "Console → System → Maintenance",
    },
    {
      key: "tutorFeeAccrual",
      name: ENGINES.tutorFeeAccrual.name,
      armed: posting.tutorFeeAccrual.enabled,
      consequence: ENGINES.tutorFeeAccrual.consequence,
      where: "Console → System → Maintenance",
    },
    {
      key: "invoicePosting",
      name: ENGINES.invoicePosting.name,
      armed: posting.invoiceIssuancePosting.enabled,
      consequence: ENGINES.invoicePosting.consequence,
      where: "Console → System → Maintenance",
    },
    {
      key: "autoCreateOpportunity",
      name: ENGINES.autoCreateOpportunity.name,
      armed: pipeline.autoCreateOpportunity,
      consequence: ENGINES.autoCreateOpportunity.consequence,
      where: "Console → Sales ops → Operations",
    },
  ];

  // Not-armed first - this is a to-do list, not a status board. Stable order within each half.
  return items.sort((a, b) => Number(a.armed) - Number(b.armed));
}
