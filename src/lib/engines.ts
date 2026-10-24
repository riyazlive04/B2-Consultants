/**
 * THE SIXTEEN ENGINES, AND WHAT EACH ONE'S SILENCE COSTS.
 *
 * Pure, isomorphic, no prisma - so the Console panel (server) and an inline notice on a feature
 * screen (which may be either) read the same words about the same switch.
 *
 * ── Why this registry exists ────────────────────────────────────────────────────────────
 * This app ships almost every engine OFF, which is right for anything that spends money or
 * messages a customer. The cost is that a built-but-disarmed feature is indistinguishable from a
 * broken one: /bookings showed four zeroes for months because no availability pattern was saved,
 * and that read as "the booking section is broken" to everyone who looked at it.
 *
 * `server/not-armed.ts` reports all sixteen in one list on the Console. That list answers "what
 * is off?" for the founder who goes looking. It could not answer the question the person on
 * /bookings was actually asking, which is "why is this screen empty?" - so `server/engine-status.ts`
 * answers that one, on the screen, from this same registry (refactor step E5).
 *
 * ── The contract each entry keeps ───────────────────────────────────────────────────────
 * `consequence` says what is NOT happening, never what the setting is. A notice that read
 * "dunning is disabled" would be a status light; "overdue instalments are never chased" is a
 * reason to care. `where` names the exact Console panel - the Console's tabs are not addressable
 * by URL (its outer `Tabs` has no `urlKey`), so the path has to be spelled out in words rather
 * than linked to.
 */

export type EngineKey =
  | "cron"
  | "availability"
  | "email"
  | "whatsapp"
  | "confirmLoop"
  | "studentWelcome"
  | "classReminders"
  | "intake"
  | "speedToLead"
  | "dunning"
  | "agreementReminders"
  | "retention"
  | "commissionAccrual"
  | "tutorFeeAccrual"
  | "invoicePosting"
  | "autoCreateOpportunity";

export type EngineCopy = {
  /** What the founder calls it. */
  name: string;
  /** What is NOT happening while it is off. */
  consequence: string;
  /**
   * Where to switch it on, in Console breadcrumbs.
   *
   * Four engines compute a sharper answer at runtime (email and WhatsApp depend on env vars,
   * class reminders can be enabled-but-rehearsing, cron reports its last tick), and
   * `not-armed.ts` overrides this string for those. This is the stable fallback.
   */
  where: string;
  /** True when the switch is a deploy/env concern rather than something in the app. */
  needsDeploy?: boolean;
};

export const ENGINES: Record<EngineKey, EngineCopy> = {
  cron: {
    name: "Scheduled jobs (cron)",
    consequence:
      "Nothing that runs on a clock happens: no slot top-up, no outreach ladder, no dunning, no digests, no retention sweep. Most other switches do nothing without it.",
    where: "The cron container / scheduled task - check the sidecar and CRON_SECRET.",
    needsDeploy: true,
  },
  availability: {
    name: "Discovery-call availability",
    consequence:
      "No slots are generated, so /book and every funnel booking page show prospects an empty calendar and no discovery call can be booked at all. The Bookings page and both specialist desks are empty as a direct result.",
    where: "Console → Sales ops → Availability",
  },
  email: {
    name: "Email (Resend)",
    consequence:
      "Password resets, invoices, the dunning ladder, digests and the SOP's opt-in alert all silently do nothing - the send is attempted and discarded.",
    where: "Conversations → Settings",
  },
  whatsapp: {
    name: "WhatsApp (WATI)",
    consequence:
      "No booking confirmations, reminders, payment nudges or SOP messages reach anyone. The outreach ladder still advances - it just talks to nobody.",
    where: "WhatsApp → Settings",
  },
  confirmLoop: {
    name: "Confirm-or-cancel unconfirmed calls",
    consequence:
      "Nobody is asked to reply YES before their call, and a slot nobody confirmed is never released - it stays booked through the no-show and blocks the prospect who would have taken it.",
    where: "Console → Sales ops → Confirm-or-cancel",
  },
  studentWelcome: {
    name: "Enrolment welcome",
    consequence:
      "A student who has signed, paid and been seated in a batch is told nothing at all. They learn their tutor, their start time and that a portal exists only if somebody remembers to message them - and the next automated thing they hear from us is a payment reminder.",
    where: "WhatsApp → Settings → Enrolment welcome",
  },
  classReminders: {
    name: "Class reminders",
    consequence:
      "Nobody is told their class is about to start. Students get the timetable only if they open the portal and look, and a coach gets no nudge before a session they are due to run - so a missed class looks identical to a class nobody scheduled.",
    where: "WhatsApp → Settings → Class reminder",
  },
  intake: {
    name: "Lead capture webhooks",
    consequence:
      "No inbound lead has ever been recorded as delivered to this app. Either no form is wired to an endpoint, or every delivery is being rejected before it lands.",
    where: "Console → Sales ops → Lead Webhook",
  },
  speedToLead: {
    name: "Speed-to-lead alert",
    consequence:
      "Nobody is told when a new lead goes uncontacted past the SLA - the 5-minute clock runs with no alarm on it.",
    where: "Console → System → Alerts & Chasing",
  },
  dunning: {
    name: "Payment chasing (dunning)",
    consequence: "Overdue instalments are never chased. The receivable ages silently.",
    where: "Console → System → Alerts & Chasing",
  },
  agreementReminders: {
    name: "Agreement chasing",
    consequence:
      "Unsigned agreements are never chased. A contract that goes quiet stays quiet until the link expires, and then it has to be voided and re-issued.",
    where: "Console → Delivery & team → Agreements",
  },
  retention: {
    name: "Data retention sweep",
    consequence:
      "Archived rows and expired invites are kept forever rather than purged on the 90-day policy.",
    where: "Console → System → Maintenance",
  },
  commissionAccrual: {
    name: "Commission accrual posting",
    consequence:
      "Commission is reported but never posted to the ledger, so the P&L understates what is owed to the team.",
    where: "Console → System → Maintenance",
  },
  tutorFeeAccrual: {
    name: "Tutor-fee accrual posting",
    consequence:
      "Tutor fees are calculated but never posted, so German Note's cost of delivery is missing from the ledger.",
    where: "Console → System → Maintenance",
  },
  invoicePosting: {
    name: "Invoice-issuance posting",
    consequence:
      "Issuing an invoice records no receivable in the ledger - revenue appears only when cash arrives.",
    where: "Console → System → Maintenance",
  },
  autoCreateOpportunity: {
    name: "New leads onto the Deals board",
    consequence:
      "Captured leads never appear on the board, so the sales team works from Pipeline and Contacts only and the board stays as empty as it was built.",
    where: "Console → Sales ops → Operations",
  },
};

export const ENGINE_KEYS = Object.keys(ENGINES) as EngineKey[];
