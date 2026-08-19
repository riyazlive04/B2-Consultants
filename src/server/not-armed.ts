import "server-only";
import { prisma } from "@/lib/prisma";
import { getEmailRuntime } from "@/lib/email";
import { getWatiRuntime } from "@/lib/wati";
import {
  getBookingCalendars,
  getMaintenanceConfig,
  getFinancePostingConfig,
  getSpeedToLeadAlertConfig,
  getDunningConfig,
  getPipelineConfig,
} from "./founder-config";
import { readDeliveryStatuses } from "./intake-route";

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
  key: string;
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
  const [email, wati, slots, maintenance, posting, speedToLead, dunning, pipeline, deliveries, heartbeat] =
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
    ]);

  /**
   * The cron is upstream of most of the rest: dunning, the outreach ladder, the slot top-up and
   * the digests all run from it, so "nothing is happening" usually resolves to this one line.
   * A heartbeat older than two hours means the scheduler is not ticking, whatever the config says.
   */
  const beatAt = (() => {
    const v = heartbeat?.value;
    const raw = v && typeof v === "object" && "at" in v ? (v as { at?: unknown }).at : null;
    return typeof raw === "string" ? new Date(raw) : null;
  })();
  const cronAlive = Boolean(beatAt && Date.now() - beatAt.getTime() < 2 * 60 * 60 * 1000);

  const anyDelivery = Object.values(deliveries).some((d) => d.at);

  const items: NotArmedItem[] = [
    {
      key: "cron",
      name: "Scheduled jobs (cron)",
      armed: cronAlive,
      consequence:
        "Nothing that runs on a clock happens: no slot top-up, no outreach ladder, no dunning, no digests, no retention sweep. Most other switches on this list do nothing without it.",
      where: beatAt
        ? `Last tick ${beatAt.toISOString()} - the scheduler has stopped. Check the cron container / task.`
        : "The scheduler has never ticked. Check the cron sidecar and CRON_SECRET.",
      needsDeploy: true,
    },
    {
      key: "availability",
      name: "Discovery-call availability",
      // Armed when at least ONE calendar can actually produce a slot. Asking whether *every*
      // calendar is on would light this warning for a deliberately paused one; asking whether
      // any exists at all would call a switched-off list armed.
      armed: slots.some((c) => c.enabled && c.weekdays.length > 0),
      consequence:
        "No slots are generated, so /book and every funnel booking page show prospects an empty calendar and no discovery call can be booked at all. The Bookings page and both specialist desks are empty as a direct result.",
      where: "Console → Sales ops → Availability",
    },
    {
      key: "email",
      name: "Email (Resend)",
      armed: email.enabled,
      consequence:
        "Password resets, invoices, the dunning ladder, digests and the SOP's opt-in alert all silently do nothing - the send is attempted and discarded.",
      where: email.envEnabled
        ? email.configured
          ? "Sending is paused - Conversations → Settings"
          : "Set RESEND_API_KEY and save a verified From address at Conversations → Settings"
        : 'Set EMAIL_ENABLED="true" and RESEND_API_KEY, then save a From address at Conversations → Settings',
      needsDeploy: !email.envEnabled || !email.apiKey,
    },
    {
      key: "whatsapp",
      name: "WhatsApp (WATI)",
      armed: wati.enabled,
      consequence:
        "No booking confirmations, reminders, payment nudges or SOP messages reach anyone. The outreach ladder still advances - it just talks to nobody.",
      where: wati.envEnabled
        ? "Sending is paused or unconfigured - /whatsapp"
        : 'Set WATI_ENABLED="true" with the endpoint and token',
      needsDeploy: !wati.envEnabled,
    },
    {
      key: "intake",
      name: "Lead capture webhooks",
      armed: anyDelivery,
      consequence:
        "No inbound lead has ever been recorded as delivered to this app. Either no form is wired to an endpoint, or every delivery is being rejected before it lands.",
      where: "Point Pabbly (or the landing page) at /api/intake/lead with INTAKE_WEBHOOK_SECRET",
    },
    {
      key: "speedToLead",
      name: "Speed-to-lead alert",
      armed: speedToLead.enabled,
      consequence: "Nobody is told when a new lead goes uncontacted past the SLA - the 5-minute clock runs with no alarm on it.",
      where: "Console → System → Alerts & Chasing",
    },
    {
      key: "dunning",
      name: "Payment chasing (dunning)",
      armed: dunning.enabled,
      consequence: "Overdue instalments are never chased. The receivable ages silently.",
      where: "Console → System → Alerts & Chasing",
    },
    {
      key: "retention",
      name: "Data retention sweep",
      armed: maintenance.retention.enabled,
      consequence: "Archived rows and expired invites are kept forever rather than purged on the 90-day policy.",
      where: "Console → System → Maintenance",
    },
    {
      key: "commissionAccrual",
      name: "Commission accrual posting",
      armed: posting.commissionAccrual.enabled,
      consequence: "Commission is reported but never posted to the ledger, so the P&L understates what is owed to the team.",
      where: "Console → System → Maintenance",
    },
    {
      key: "tutorFeeAccrual",
      name: "Tutor-fee accrual posting",
      armed: posting.tutorFeeAccrual.enabled,
      consequence: "Tutor fees are calculated but never posted, so German Note's cost of delivery is missing from the ledger.",
      where: "Console → System → Maintenance",
    },
    {
      key: "invoicePosting",
      name: "Invoice-issuance posting",
      armed: posting.invoiceIssuancePosting.enabled,
      consequence: "Issuing an invoice records no receivable in the ledger - revenue appears only when cash arrives.",
      where: "Console → System → Maintenance",
    },
    {
      key: "autoCreateOpportunity",
      name: "New leads onto the Opportunities board",
      armed: pipeline.autoCreateOpportunity,
      consequence:
        "Captured leads never appear on the board, so the sales team works from Pipeline and Contacts only and the board stays as empty as it was built.",
      where: "Console → Sales ops → Operations",
    },
  ];

  // Not-armed first - this is a to-do list, not a status board. Stable order within each half.
  return items.sort((a, b) => Number(a.armed) - Number(b.armed));
}
