/**
 * Stage messages - one email and one WhatsApp per pipeline stage, sent every time a lead enters
 * that stage, however old the lead is and whoever moved it.
 *
 * Isomorphic: NO prisma client, NO server-only, so the settings form imports the same defaults
 * and schema the sweep reads. The sweep lives in `server/stage-messages.ts`.
 *
 * WhatsApp is template-only (Meta rule for business-initiated messages), so the WhatsApp half has
 * no text here: each stage owns a `STAGE_<STAGE>` touchpoint that is bound to an approved WATI
 * template in WhatsApp → Settings, exactly like every other touchpoint. Until one is bound, that
 * stage sends its email only and the WhatsApp attempt is logged once as skipped.
 */

import { z } from "zod";
import type { LeadStage, WhatsAppKind } from "@prisma/client";
import { LEAD_STAGE_LABELS } from "./labels";

/** Every LeadStage, in funnel order. Mirrors the Prisma enum. */
export const STAGE_MESSAGE_STAGES = [
  "NEW_LEAD",
  "WHATSAPP_SENT",
  "STRATEGY_CALL_BOOKED",
  "DISCO_BOOKED",
  "DISCO_NOT_BOOKED",
  "DISCO_COMPLETED",
  "SSS_BOOKED",
  "SSS_COMPLETED",
  "PROPOSAL_SENT",
  "SENT_TO_WORKSHOP",
  "WORKSHOP_FOLLOWUP",
  "OFFER_FOLLOWUP",
  "DEPOSIT_FOLLOWUP",
  "DEPOSIT_PAID",
  "WON",
  "LOST",
  "NO_SHOW",
] as const satisfies readonly LeadStage[];

export type StageKind = `STAGE_${(typeof STAGE_MESSAGE_STAGES)[number]}`;

/** The WhatsApp touchpoint a stage sends through. */
export function stageWhatsAppKind(stage: LeadStage): WhatsAppKind {
  return `STAGE_${stage}` as WhatsAppKind;
}

export const STAGE_WHATSAPP_KINDS = STAGE_MESSAGE_STAGES.map((s) => `STAGE_${s}` as StageKind);

// Touchpoint metadata for lib/whatsapp.ts, generated so a new stage cannot be half-wired.
export const STAGE_KIND_LABELS = Object.fromEntries(
  STAGE_MESSAGE_STAGES.map((s) => [`STAGE_${s}`, `Stage · ${LEAD_STAGE_LABELS[s] ?? s}`]),
) as Record<StageKind, string>;

export const STAGE_KIND_HINTS = Object.fromEntries(
  STAGE_MESSAGE_STAGES.map((s) => [
    `STAGE_${s}`,
    `Sent every time a lead enters "${LEAD_STAGE_LABELS[s] ?? s}" - manual or automatic. Toggle it per stage in Automation → Stage messages.`,
  ]),
) as Record<StageKind, string>;

/**
 * Every variable a lead's stage can supply - the lead-facing names the SOP and booking templates
 * use, so any of those approved templates can be bound to a stage. The call details come from the
 * lead's booked call (server/stage-messages.ts); when a lead has none, a template that needs them
 * is skipped with the reason logged.
 */
const STAGE_VARS = ["name", "sender", "booking_url", "date", "time", "slot_time", "zoom_link", "sss_url"] as const;

export const STAGE_KIND_VARS = Object.fromEntries(
  STAGE_MESSAGE_STAGES.map((s) => [`STAGE_${s}`, STAGE_VARS as readonly string[]]),
) as Record<StageKind, readonly string[]>;

// ───────────────────────────── config ─────────────────────────────

const stageEntrySchema = z.object({
  email: z.boolean(),
  whatsapp: z.boolean(),
  subject: z.string().max(200),
  body: z.string().max(5000),
});
export type StageMessage = z.infer<typeof stageEntrySchema>;

export const stageMessagesSchema = z.object({
  enabled: z.boolean(),
  stages: z.record(z.enum(STAGE_MESSAGE_STAGES), stageEntrySchema),
});
export type StageMessagesConfig = {
  enabled: boolean;
  stages: Record<LeadStage, StageMessage>;
};

export const STAGE_MESSAGES_KEY = "stageMessages";

const SIGN_OFF = `\n\nB2 Consultants`;
const BOOK = `https://optin.b2consultants.de/apply`;

/**
 * Default copy. Tokens: {{first_name}}, {{name}}, {{email}}, {{phone}} (see renderTokens).
 * Written in the voice of the approved SOP templates; every one is editable in the Console.
 */
const DEFAULT_COPY: Record<LeadStage, { subject: string; body: string }> = {
  NEW_LEAD: {
    subject: `{{first_name}}, welcome to B2 Consultants`,
    body: `Hi {{first_name}},\n\nThanks for showing interest in finding your next job in Germany.\n\nThe next step is a free 20 minute Personalized Discovery Call with our team, so we can understand your situation. You can book it here:\n${BOOK}`,
  },
  WHATSAPP_SENT: {
    subject: `{{first_name}}, we have sent you a WhatsApp message`,
    body: `Hi {{first_name}},\n\nWe have just sent you a message on WhatsApp. Please check it and reply there, or book your free Discovery Call directly here:\n${BOOK}`,
  },
  STRATEGY_CALL_BOOKED: {
    subject: `{{first_name}}, your Discovery Call is booked`,
    body: `Hi {{first_name}},\n\nThank you for booking your Personalized Discovery Call with B2 Consultants. Our team is preparing for it and will reach out if we need anything more from you.\n\nMeanwhile, you can read what our students say about us:\nhttps://casestudies.b2consultants.de/casestudies`,
  },
  DISCO_BOOKED: {
    subject: `{{first_name}}, your Discovery Call is confirmed`,
    body: `Hi {{first_name}},\n\nGood news: your Discovery Call is confirmed. Please keep the time free and join a few minutes early. If anything changes, just reply to this email.`,
  },
  DISCO_NOT_BOOKED: {
    subject: `{{first_name}}, your free Discovery Call spot is still open`,
    body: `Hi {{first_name}},\n\nWe noticed you have not booked your free Personalized Discovery Call yet. Spots are limited each week, and we do not want you to miss out.\n\nYou can book here:\n${BOOK}`,
  },
  DISCO_COMPLETED: {
    subject: `Thank you for your Discovery Call, {{first_name}}`,
    body: `Hi {{first_name}},\n\nThank you for taking the time to speak with our team. We will be in touch shortly with the next steps for your move to Germany.`,
  },
  SSS_BOOKED: {
    subject: `{{first_name}}, your Success Strategy Session is booked`,
    body: `Hi {{first_name}},\n\nYour Success Strategy Session with B2 Consultants is booked. In this session we will map out your personal plan for landing a job in Germany. We will send you a reminder before the call.`,
  },
  SSS_COMPLETED: {
    subject: `{{first_name}}, your Success Strategy Session is confirmed`,
    body: `Hi {{first_name}},\n\nThanks for confirming your Success Strategy Session. We look forward to speaking with you. If you have any questions before the call, just reply to this email.`,
  },
  PROPOSAL_SENT: {
    subject: `{{first_name}}, your B2 Consultants offer`,
    body: `Hi {{first_name}},\n\nThank you for your time in the Success Strategy Session. You now have our offer for the coaching programme. Take your time to go through it, and reply to this email if you have any questions. We are happy to help you decide.`,
  },
  SENT_TO_WORKSHOP: {
    subject: `{{first_name}}, you are invited to our workshop`,
    body: `Hi {{first_name}},\n\nWe think our workshop is the best next step for you. It covers what it really takes to get a job in Germany. Our team will share the details with you shortly.`,
  },
  WORKSHOP_FOLLOWUP: {
    subject: `{{first_name}}, how did you find the workshop?`,
    body: `Hi {{first_name}},\n\nThank you for joining our workshop. We would love to hear what you took away from it, and to help you with your next step. Just reply to this email.`,
  },
  OFFER_FOLLOWUP: {
    subject: `{{first_name}}, any questions about our offer?`,
    body: `Hi {{first_name}},\n\nWe wanted to check in about the offer we shared. If anything is holding you back, reply to this email and let us know. We are here to help.`,
  },
  DEPOSIT_FOLLOWUP: {
    subject: `{{first_name}}, one step left to secure your place`,
    body: `Hi {{first_name}},\n\nWe are glad you have decided to join us. The only step left is the deposit to secure your place in the programme. Reply to this email if you need the payment details again or have any questions.`,
  },
  DEPOSIT_PAID: {
    subject: `{{first_name}}, your place is confirmed`,
    body: `Hi {{first_name}},\n\nWe have received your deposit, and your place in the programme is confirmed. Welcome to B2 Consultants! Our team will be in touch with your onboarding details shortly.`,
  },
  WON: {
    subject: `Welcome to B2 Consultants, {{first_name}}!`,
    body: `Hi {{first_name}},\n\nWelcome to the B2 Consultants programme! We are excited to work with you on your journey to a job in Germany. Your coach will contact you soon with the first steps.`,
  },
  LOST: {
    subject: `{{first_name}}, thank you for your interest`,
    body: `Hi {{first_name}},\n\nThank you for your interest in B2 Consultants. It looks like now is not the right time, and that is completely fine. Whenever you are ready, you are welcome to come back to us:\n${BOOK}\n\nWishing you all the best with your plans for Germany.`,
  },
  NO_SHOW: {
    subject: `{{first_name}}, we missed you on the call`,
    body: `Hi {{first_name}},\n\nWe were looking forward to speaking with you, but it looks like you could not make it to your call. No problem, you can book a new time here:\n${BOOK}`,
  },
};

export const DEFAULT_STAGE_MESSAGES: StageMessagesConfig = {
  enabled: true,
  stages: Object.fromEntries(
    STAGE_MESSAGE_STAGES.map((s) => [
      s,
      { email: true, whatsapp: true, subject: DEFAULT_COPY[s].subject, body: DEFAULT_COPY[s].body + SIGN_OFF },
    ]),
  ) as Record<LeadStage, StageMessage>,
};

/** A stored row, filled in over the defaults so a stage added later is never missing. */
export function coerceStageMessages(value: unknown): StageMessagesConfig {
  const parsed = stageMessagesSchema.partial().safeParse(value);
  if (!parsed.success) return DEFAULT_STAGE_MESSAGES;
  return {
    enabled: parsed.data.enabled ?? DEFAULT_STAGE_MESSAGES.enabled,
    stages: { ...DEFAULT_STAGE_MESSAGES.stages, ...(parsed.data.stages ?? {}) } as Record<LeadStage, StageMessage>,
  };
}
