/**
 * WhatsApp (WATI) — isomorphic constants + helpers. NO prisma, NO server-only, NO secrets,
 * so both the client settings UI and the server engine import from here. The server-only
 * config reader + HTTP client live in `wati.ts`; the sending service in `server/whatsapp.ts`.
 *
 * This is the "Wave-2" outbound-messaging layer the Wave-1 code anticipated (schema §420/§756,
 * SALES-LOGIC §2/§7). Everything stays inert until WATI_ENABLED + credentials + template names
 * are configured — see wati.ts.
 */

import type { WhatsAppKind, WhatsAppStatus } from "@prisma/client";

// ── Touchpoints (mirror the Prisma WhatsAppKind enum, in display order) ──
export const WHATSAPP_KINDS = [
  "DISCO_REMINDER",
  "BOOKING_CONFIRMATION",
  "BOOKING_REMINDER",
  "NO_SHOW_FOLLOWUP",
  "PAYMENT_REMINDER",
  "EMI_PRE_DUE",
  "CHECKIN_NUDGE",
  "SPRINT_MISS_NUDGE",
  "AGREEMENT_SEND",
  "AGREEMENT_OTP",
  "AGREEMENT_REMINDER",
  "AGREEMENT_COPY",
  "MANUAL",
  "SOP_INTRO",
  "SOP_FOLLOWUP",
  "SOP_DISCO_WELCOME",
  "SOP_DISCO_CONFIRM_1",
  "SOP_DISCO_CONFIRM_2",
  "SOP_DISCO_CANCEL",
  "SOP_SSS_CONFIRM_1",
  "SOP_SSS_CONFIRM_2",
  "SOP_SSS_CANCEL",
  "BOOKING_CONFIRM_REQUEST",
  "BOOKING_RESCHEDULED",
  "BOOKING_AUTO_CANCELLED",
  "SSS_RESCHEDULED",
] as const satisfies readonly WhatsAppKind[];

export const WHATSAPP_KIND_LABELS: Record<WhatsAppKind, string> = {
  DISCO_REMINDER: "Discovery-call reminder",
  BOOKING_CONFIRMATION: "Booking confirmation",
  BOOKING_REMINDER: "Pre-call reminder",
  NO_SHOW_FOLLOWUP: "No-show follow-up",
  PAYMENT_REMINDER: "Payment reminder",
  EMI_PRE_DUE: "EMI due-soon reminder",
  CHECKIN_NUDGE: "Check-in nudge",
  SPRINT_MISS_NUDGE: "Sprint-miss nudge",
  AGREEMENT_SEND: "Agreement signing link",
  AGREEMENT_OTP: "Agreement signing code",
  AGREEMENT_REMINDER: "Unsigned agreement reminder",
  AGREEMENT_COPY: "Countersigned copy",
  MANUAL: "Manual message",
  SOP_INTRO: "SOP 3 · WhatsApp intro",
  SOP_FOLLOWUP: "SOP 6 · Follow-up, not booked",
  SOP_DISCO_WELCOME: "SOP 13 · Disco welcome",
  SOP_DISCO_CONFIRM_1: "SOP 14 · Disco confirmation 1",
  SOP_DISCO_CONFIRM_2: "SOP 15 · Disco confirmation 2",
  SOP_DISCO_CANCEL: "SOP 16 · Disco cancellation",
  SOP_SSS_CONFIRM_1: "SOP 19 · SSS confirmation 1",
  SOP_SSS_CONFIRM_2: "SOP 20 · SSS confirmation 2",
  SOP_SSS_CANCEL: "SOP 21 · SSS cancellation",
  BOOKING_CONFIRM_REQUEST: "Booking · confirm request",
  BOOKING_RESCHEDULED: "Booking · rescheduled notice",
  BOOKING_AUTO_CANCELLED: "Booking · auto-cancelled",
  SSS_RESCHEDULED: "SSS · rescheduled notice",
};

/** One-line description of when each touchpoint fires — shown in the settings UI. */
export const WHATSAPP_KIND_HINTS: Record<WhatsAppKind, string> = {
  DISCO_REMINDER: "Un-booked leads (New / Disco-not-booked) who haven't scheduled a call yet.",
  BOOKING_CONFIRMATION: "Sent once, right after a prospect books a discovery-call slot.",
  BOOKING_REMINDER: "Before an upcoming booked slot (per the lead-hours cadence).",
  NO_SHOW_FOLLOWUP: "A lead marked No-show — nudge them to rebook.",
  PAYMENT_REMINDER: "A pending payment that is overdue.",
  EMI_PRE_DUE: "An instalment falls due in the next few days — lands BEFORE the due date, unlike the overdue reminder.",
  CHECKIN_NUDGE: "A student whose coaching check-in date has arrived / passed.",
  SPRINT_MISS_NUDGE: "A student who missed a sprint-week target.",
  AGREEMENT_SEND: "The founder countersigned an agreement — carries the tokenized signing link.",
  AGREEMENT_OTP: "The one-time code that binds the signature to control of this number.",
  AGREEMENT_REMINDER: "An issued agreement is still unsigned and the link has not expired.",
  AGREEMENT_COPY:
    "The student just signed — carries the link to their sealed, countersigned copy. Delivering this is what marks an agreement Completed.",
  MANUAL: "Free-form one-off send triggered by a human from a section row.",
  SOP_INTRO: "Outreach SOP Step 3 — sent immediately after opt-in (target <5 min).",
  SOP_FOLLOWUP: "Outreach SOP Step 6 — still not booked at the 2-hour check.",
  SOP_DISCO_WELCOME: "Outreach SOP Step 13 — BANT verdict is YES or MAYBE and the call is booked.",
  SOP_DISCO_CONFIRM_1: "Outreach SOP Step 14 — at least 36h before the discovery call.",
  SOP_DISCO_CONFIRM_2: "Outreach SOP Step 15 — at least 24h before, if Step 14 drew no reply.",
  SOP_DISCO_CANCEL: "Outreach SOP Step 16 — at least 12h before, unconfirmed after two calls.",
  SOP_SSS_CONFIRM_1: "Outreach SOP Step 19 — at least 24h before the SSS. Carries the personalized video.",
  SOP_SSS_CONFIRM_2: "Outreach SOP Step 20 — at least 12h before the SSS, if Step 19 drew no reply.",
  SOP_SSS_CANCEL: "Outreach SOP Step 21 — at least 10h before the SSS, still unconfirmed.",
  BOOKING_CONFIRM_REQUEST: "Bookings confirmation loop — asks the prospect to reply YES to hold an upcoming booked slot.",
  BOOKING_RESCHEDULED: "Bookings confirmation loop — the call was moved to a new time (manual postpone or promoted into a freed earlier slot).",
  BOOKING_AUTO_CANCELLED: "Bookings confirmation loop — no confirmation before the cut-off, so the slot was released; invites them to rebook.",
  SSS_RESCHEDULED: "SSS calendar — the Success Strategy Session was moved to a new time (founder blocked the slot/day, or a manual/drag reschedule).",
};

/**
 * The variables this app CAN supply for each touchpoint — an offer, not a contract.
 *
 * The actual parameters sent to WATI are driven by the mapped template's own variable list
 * (`WatiTemplateConfig.params`), because a WhatsApp template only accepts exactly the variables it
 * was approved with. B2's real WATI account, for example, has 76 templates taking just `{{name}}`
 * and 38 taking none — sending an extra `booking_url` would be rejected outright.
 *
 * So: the Admin declares the template's variables in Settings; we fill each from this pool. If a
 * template asks for something we can't supply for that touchpoint, the send is skipped and says so.
 */
export const WHATSAPP_AVAILABLE_VARS: Record<WhatsAppKind, readonly string[]> = {
  DISCO_REMINDER: ["name", "booking_url"],
  BOOKING_CONFIRMATION: ["name", "slot_time", "booking_url"],
  BOOKING_REMINDER: ["name", "slot_time", "booking_url"],
  NO_SHOW_FOLLOWUP: ["name", "booking_url"],
  PAYMENT_REMINDER: ["name", "amount"],
  // `due_date` is what makes this reminder land as "due on the 3rd" rather than a vague nudge.
  // `seq`/`total` let a template say "instalment 2 of 3" — both offered, neither required.
  EMI_PRE_DUE: ["name", "amount", "due_date", "seq", "total"],
  CHECKIN_NUDGE: ["name"],
  SPRINT_MISS_NUDGE: ["name"],
  // `sign_url` is the full tokenized link. If the approved template puts the token in a dynamic
  // URL-button suffix instead of the body, map `sign_token` — the raw base64url token is 43
  // URL-safe characters and slots straight into the suffix.
  AGREEMENT_SEND: ["name", "sign_url", "sign_token", "document_no"],
  AGREEMENT_OTP: ["name", "code"],
  AGREEMENT_REMINDER: ["name", "sign_url", "sign_token", "document_no"],
  // `copy_url` is the tokenized link to the SEALED pdf — the same token the signing link carried
  // (signing never clears it), resolved by a loader that only serves signed rows.
  AGREEMENT_COPY: ["name", "copy_url", "document_no"],
  MANUAL: ["name"],
  // ── Outreach SOP. These names are the CONTRACT with the approved WATI templates: whatever the
  // template declares must be a subset of what the touchpoint offers here, or the send is skipped
  // with an explanatory message rather than delivering "Hi ,". See docs/WHATSAPP_TEMPLATES.md,
  // which is the submission pack these were written against.
  //
  // The SOP's links (optin.b2consultants.de/apply, /lang, casestudies…, /sss) are LITERAL text in
  // the template body, not variables — they never change per prospect, and Meta reviews a static
  // URL once instead of on every send.
  SOP_INTRO: ["name", "sender"],
  SOP_FOLLOWUP: ["name", "sender"],
  SOP_DISCO_WELCOME: ["name", "sender", "date", "time"],
  SOP_DISCO_CONFIRM_1: ["name", "date", "time", "zoom_link"],
  SOP_DISCO_CONFIRM_2: ["name", "date", "time", "zoom_link"],
  SOP_DISCO_CANCEL: ["name"],
  SOP_SSS_CONFIRM_1: ["name", "sender", "date", "time"],
  SOP_SSS_CONFIRM_2: ["name", "date", "time", "zoom_link"],
  SOP_SSS_CANCEL: ["name"],
  // Bookings confirmation loop. `slot_time` is the IST call time; the reschedule notice reuses it
  // to name the NEW time. `booking_url` is the public /book link for rebooking after a cancel.
  BOOKING_CONFIRM_REQUEST: ["name", "slot_time", "booking_url"],
  BOOKING_RESCHEDULED: ["name", "slot_time", "booking_url"],
  BOOKING_AUTO_CANCELLED: ["name", "booking_url"],
  // SSS calendar. `slot_time` is the NEW SSS time (IST); `sss_url` is the /sss rebook link.
  SSS_RESCHEDULED: ["name", "slot_time", "sss_url"],
};

export const WHATSAPP_STATUS_LABELS: Record<WhatsAppStatus, string> = {
  SKIPPED: "Skipped",
  QUEUED: "Queued",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  REPLIED: "Replied",
  FAILED: "Failed",
};

/** Maps a status to the app's Green/Amber/Red-ish semantic tone (for the badge). */
export function whatsappStatusTone(status: WhatsAppStatus): "good" | "warn" | "bad" | "muted" {
  switch (status) {
    case "READ":
    case "REPLIED":
      return "good";
    case "SENT":
    case "DELIVERED":
      return "warn";
    case "FAILED":
      return "bad";
    default:
      return "muted"; // SKIPPED / QUEUED
  }
}

// ── Cadence (editable in settings; these are the defaults) ──
export type WatiCadence = {
  /** Wait this long after a lead first arrives before the first discovery reminder. */
  discoFirstDelayHours: number;
  /** Minimum spacing between two discovery reminders to the same lead. */
  discoRepeatHours: number;
  /** Hard cap on discovery reminders per lead. */
  discoMaxReminders: number;
  /** Hours-before-slot at which to send a pre-call reminder (each once). */
  bookingReminderLeadHours: number[];
  /** Delay after a No-show before the rebook nudge. */
  noShowDelayHours: number;
  /** Minimum spacing between payment reminders for the same pending payment. */
  paymentRepeatHours: number;
  /**
   * Days-before-due at which to send the EMI pre-due reminder, one message per entry per
   * instalment. `0` means "on the due day itself". Empty disables the touchpoint entirely.
   */
  emiPreDueLeadDays: number[];
  /**
   * SAFETY: when true the EMI pre-due reminder is rehearsed, never sent — each candidate
   * writes a SKIPPED "DRY RUN" row naming the recipient and template, so the exact blast can
   * be reviewed before one real message leaves. Defaults ON deliberately: this touchpoint
   * fans out to every paying student at once, so the safe default is the one where a mistake
   * costs nothing.
   */
  emiPreDueDryRun: boolean;
  /** Minimum spacing between check-in / sprint nudges for the same student. */
  studentRepeatHours: number;
  /** Overall safety cap: max messages a single run of the engine will send. */
  maxPerRun: number;
};

export const DEFAULT_CADENCE: WatiCadence = {
  discoFirstDelayHours: 2,
  discoRepeatHours: 24,
  discoMaxReminders: 3,
  bookingReminderLeadHours: [24, 2],
  noShowDelayHours: 2,
  paymentRepeatHours: 72,
  emiPreDueLeadDays: [3, 0], // three days out, then again on the day
  emiPreDueDryRun: true,
  studentRepeatHours: 48,
  maxPerRun: 200,
};

/**
 * A touchpoint → WATI template binding. `params` is the template's OWN variable list, in the exact
 * order WhatsApp approved it (WATI's export calls this `TemplateParamMapping`). An empty array is
 * legitimate — many approved templates take no variables at all.
 */
export type WatiTemplateConfig = { name: string; broadcastName?: string; params: string[] };
export type WatiTemplateMap = Partial<Record<WhatsAppKind, WatiTemplateConfig>>;

/**
 * Editable, non-secret config persisted in AppSetting("watiConfig"). Secrets (endpoint URL,
 * access token, webhook secret) live in env — never here. `paused` lets Admin stop all sends
 * without touching env.
 *
 * `defaultCountry` is an ISO-3166 alpha-2 code (e.g. "IN"), NOT a dialing code: it's only used to
 * resolve numbers typed WITHOUT a country code. Contacts abroad (German students) must be stored
 * with "+49…" — see src/lib/phone.ts, which fails closed rather than guessing a country.
 */
export type WatiSettings = {
  paused: boolean;
  defaultCountry: string; // ISO-3166 alpha-2, e.g. "IN"
  templates: WatiTemplateMap;
  cadence: WatiCadence;
};

/**
 * No touchpoint is mapped by default, on purpose.
 *
 * We originally seeded `initiate_chatbot` / `confirmation_calendly_app` / `calendly_qualification` /
 * `get_calendly_app_confirmation` from a WATI dashboard export. Querying the live API later showed
 * all four are **DELETED** (the export carries no status field — every row said `NewStatus: 0`).
 * Shipping a default that points at deleted templates would send nothing but `FAILED` rows.
 *
 * As of the live check: 69 of 119 templates are APPROVED, none of them `UTILITY`, and none of them
 * is a discovery-call or booking template — they are webinar/workshop broadcasts. So the mapping
 * must be chosen by a human against the live catalogue (WhatsApp → Settings → Refresh templates),
 * and an unmapped touchpoint never sends.
 */
export const DEFAULT_TEMPLATE_MAP: WatiTemplateMap = {};

export const DEFAULT_WATI_SETTINGS: WatiSettings = {
  paused: false,
  defaultCountry: "IN",
  templates: DEFAULT_TEMPLATE_MAP,
  cadence: DEFAULT_CADENCE,
};

/** A template as reported by WATI's getMessageTemplates API (cached for the settings dropdown). */
export type WatiTemplateSummary = {
  name: string;
  category: string; // UTILITY | MARKETING | AUTHENTICATION
  status: string; // APPROVED | PENDING | REJECTED
  language: string;
  params: string[]; // the template's own variables, in order
};

/**
 * Countries B2 actually deals with, for the settings dropdown (ISO-3166-1 alpha-2).
 * Static data only — kept here, not in phone.ts, so the client settings form can render it
 * without pulling libphonenumber-js into the browser bundle.
 */
export const COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: "IN", label: "India (+91)" },
  { value: "DE", label: "Germany (+49)" },
  { value: "AT", label: "Austria (+43)" },
  { value: "CH", label: "Switzerland (+41)" },
  { value: "GB", label: "United Kingdom (+44)" },
  { value: "US", label: "United States (+1)" },
  { value: "AE", label: "United Arab Emirates (+971)" },
];

// Phone normalization itself lives in src/lib/phone.ts (libphonenumber-js). It is intentionally
// NOT re-exported here: this module is imported by client components, and the phone library is
// server-only baggage we don't want in the browser bundle.
