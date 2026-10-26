"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { LeadSource, type LeadStage, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, type AppSession } from "@/lib/rbac";
import { istWallToUtc, parseDateInput, toDateInputValue } from "@/lib/dates";
import { clientIpFrom, takeTokens, RATE_RULES } from "@/lib/rate-limit";
import { INTAKE_OPTIONS } from "@/lib/booking-intake";
import { qualifiedFromBant } from "@/lib/outreach-sop";
import { alreadyBookedMessage, findLiveBookingForPerson } from "@/lib/booking-identity";
import { AGREEMENT_PROVIDER } from "@/lib/agreement";
import { getWatiRuntime } from "@/lib/wati";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { markDiscoveryConfirmed } from "./lead-stage-auto";
import { journeyForBooking, markSopDiscoConfirmed } from "./outreach";
import {
  CONSENT_LABEL,
  CONSENT_LABEL_NO_SLOTS,
  CONSENT_POLICY_VERSION,
  CONSENT_VALUE,
} from "@/lib/consent";
import { bookingRulesConfigSchema } from "@/lib/config-schema";
import { coerceDurationMinutes } from "@/lib/duration";
import { releasedSlotStatus } from "@/lib/booking-hold";
import { optionalRule, rule } from "@/lib/field-rules";
import { activityStamp } from "@/lib/activity-actions";
import { slotStartsForRange, WEEKDAY_KEYS } from "@/lib/slot-plan";
import { BOOKING_RULES_KEY, getBookingRulesConfig, writeBookingRulesConfig } from "./founder-config";
import { logActivity, diffFields } from "./activity-log";
import { emitTrigger } from "./automation";
import { upsertIntakeLead } from "./lead-intake";
import { syncDefaultOpportunity } from "./opportunity-sync";
import { observedOriginDomain } from "./request-origin";
import { mirrorBookingScoreToLead } from "./lead-qualification";
import { scoreSubmission } from "./qualification";
import { sendBookingConfirmation, sendBookingRescheduled } from "./whatsapp";
import { promoteIntoFreedSlot, runBookingConfirmations } from "./booking-automation";
import { recordSlotRelease } from "./slot-release";
import { syncBookingMeeting } from "./zoom-meetings";
import { prepareConfirmLoopSave } from "./confirm-loop-config";
import { sendEmailMessage } from "./messaging";
import { afterResponse } from "./after-response";
import type { ActionResult } from "./finance-actions";

/**
 * Wave-1 booking (Synamate in-sourcing).
 *  - submitBooking is PUBLIC (no session): the prospect-facing booking page calls it.
 *  - The slot/booking management actions are Admin-only (requireSection("bookings")).
 * No messaging happens here - confirmations/reminders are Wave-2, gated on sign-off.
 */

// Values a select may legitimately hold (guards against tampered POSTs).
const valuesOf = (field: keyof typeof INTAKE_OPTIONS) =>
  (INTAKE_OPTIONS[field] as readonly { value: string }[]).map((o) => o.value) as [string, ...string[]];
const optional = (field: keyof typeof INTAKE_OPTIONS) =>
  z.enum(valuesOf(field)).optional().or(z.literal(""));

// Map "how did you hear about us" to the marketing-channel enum on the lead.
const HOW_TO_CHANNEL: Record<string, LeadSource> = {
  instagram: "INSTAGRAM",
  youtube: "YOUTUBE",
  linkedin: "LINKEDIN",
  referral: "REFERRAL",
  workshop: "WORKSHOP",
  /**
   * `LeadSource` has no FACEBOOK or GOOGLE member, so both coarsen to OTHER here. Nothing is
   * lost: the precise answer is stored verbatim on `BookingRequest.howKnowUs`, which is what
   * the closer reads - only the roll-up enum blurs. FACEBOOK is deliberately NOT mapped to
   * META_ADS: that value means "arrived via the Meta Lead Ads webhook", and using it for
   * someone who typed a form would corrupt paid-channel attribution.
   *
   * Worth an enum migration if either channel starts carrying real volume.
   */
  facebook: "OTHER",
  google: "OTHER",
  // Retired answers, still mapped so a replay of historical submissions lands the same way.
  summit: "SUMMIT",
  ghosted_blueprint: "GHOSTED_BLUEPRINT",
  other: "OTHER",
};

/**
 * Stages a booking must NOT drag a lead out of - they are already at, or past, the booked-call
 * column. Everything else advances (see the note at the update itself).
 *
 * `STRATEGY_CALL_BOOKED` is here because it is the destination: rebooking would otherwise write
 * a stage-history row saying the lead moved from a stage to itself, and the desk's "moved today"
 * counts read that table.
 *
 * The workshop pair is deliberately NOT here. Someone routed to the workshop who then books a
 * discovery call HAS a discovery call booked, and the board should say so.
 */
const HOLDS_THROUGH_BOOKING: ReadonlySet<LeadStage> = new Set<LeadStage>([
  "STRATEGY_CALL_BOOKED",
  "DISCO_BOOKED",
  "DISCO_COMPLETED",
  "SSS_BOOKED",
  "SSS_COMPLETED",
  "PROPOSAL_SENT",
  "OFFER_FOLLOWUP",
  "DEPOSIT_FOLLOWUP",
  "DEPOSIT_PAID",
  "WON",
]);

/** A select whose answer the form now insists on. Blank is refused rather than stored as null. */
const requiredChoice = (field: keyof typeof INTAKE_OPTIONS, message: string) =>
  z.enum(valuesOf(field), { message });

const bookingSchema = z.object({
  slotId: z.string().min(1, "Please choose an available time").max(64),
  // Character rules come from lib/field-rules so the browser filter and this parse can't drift.
  // These are the PUBLIC form's fields - the filter is unreachable for a crafted POST, so the
  // schema is the only real gate here.
  name: rule("name"),
  // The email rule folds to lowercase (not just trims): this address is the key the SOP's Step 10
  // cross-check matches a lead to their booking on, and "Ameen@X.com" vs "ameen@x.com" would
  // report a booked prospect as "not booked".
  email: rule("email"),
  phone: rule("phone"),
  /**
   * ── Required, because the form marks them required ────────────────────────────
   * The public questionnaire now stars every one of these. Leaving the schema permissive would
   * mean the browser is the only thing enforcing them, and a crafted POST could bank a booked
   * slot with no LinkedIn, no salary band and no BANT answers at all - which is precisely the
   * submission the auto-disqualify gate cannot judge.
   *
   * Everything BELOW this block stays optional: those fields were removed from the form, and
   * requiring a field nothing renders would reject every real submission.
   */
  linkedInProfile: rule("url"),
  currentJobTitle: z.string().trim().min(1, "Please tell us your current job title").max(160),
  prospectIndustry: z.string().trim().min(1, "Please tell us which industry you work in").max(160),
  whyGermany: z
    .string()
    .trim()
    .min(1, "Please tell us why you want to work in Germany")
    .max(2000, "Please keep this under 2000 characters"),
  highestEducation: requiredChoice("highestEducation", "Please pick your highest qualification"),
  yearsExperience: requiredChoice("yearsExperience", "Please pick your years of experience"),
  alreadyApplied: requiredChoice("alreadyApplied", "Please tell us where you are with applying"),
  whenStartGermany: requiredChoice("whenStartGermany", "Please pick when you want to start"),
  germanVisa: requiredChoice("germanVisa", "Please tell us about your visa status"),
  germanLevel: requiredChoice("germanLevel", "Please pick your German level"),
  willingnessLearnGerman: requiredChoice("willingnessLearnGerman", "Please tell us if you're ready to learn German"),
  currentIncome: requiredChoice("currentIncome", "Please pick your current monthly salary"),
  readyToInvest: requiredChoice("readyToInvest", "Please tell us how prepared you are to invest"),
  decisionMaking: requiredChoice("decisionMaking", "Please tell us who makes the decision"),
  howKnowUs: requiredChoice("howKnowUs", "Please tell us where you heard about us"),

  // ── No longer on the public form; still accepted so older clients and the admin paths work ──
  whatsapp: optionalRule("phone"),
  city: optionalRule("city"),
  participateWorkshop: optional("participateWorkshop"),
  reasonForCall: z.string().trim().max(2000, "Please keep this under 2000 characters").optional(),
  commitment: optional("commitment"),
  // GDPR consent (spec §15). Optional in the SCHEMA but mandatory in the ACTION: an unticked
  // checkbox posts nothing at all, and a bare z.literal would fail with "Invalid literal
  // value" - useless to a prospect. Parsed loosely, then refused explicitly below.
  consent: z.string().optional(),
  // spam honeypot - real users never fill this hidden field
  company_website: z.string().optional(),
  utm: z.string().max(4000).optional(), // JSON blob captured client-side from the URL
});

/** Keep only bounded, string-valued utm_* entries from the client-supplied blob. */
function sanitizeUtm(rawJson: string): Record<string, string> | null {
  try {
    const obj = JSON.parse(rawJson);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const utm: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (Object.keys(utm).length >= 10) break;
      if (k.toLowerCase().startsWith("utm_") && typeof v === "string" && v) {
        utm[k.toLowerCase().slice(0, 64)] = v.slice(0, 200);
      }
    }
    return Object.keys(utm).length ? utm : null;
  } catch {
    return null; // malformed utm is dropped, never fatal
  }
}

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Please check the form and try again";
}

function clean(v: string | undefined): string | null {
  return v && v.trim() ? v.trim() : null;
}

/**
 * The live discovery booking this person already holds, if any - see `findLiveBookingForPerson`.
 *
 * "Live" is BOOKED with the slot still ahead. A call whose time has passed without anyone
 * recording an outcome is not live: it must not stop that person booking again.
 *
 * The candidate set is small by construction (upcoming booked calls only), so the phone
 * comparison runs in JS, where libphonenumber can normalise both sides - SQL cannot.
 */
async function liveBookingFor(
  db: Pick<Prisma.TransactionClient, "bookingRequest">,
  person: { phone: string; whatsapp?: string | null; email: string },
) {
  const live = await db.bookingRequest.findMany({
    where: { status: "BOOKED", slot: { is: { startsAt: { gt: new Date() } } } },
    select: { id: true, phone: true, whatsapp: true, email: true },
    take: 1000,
  });
  return findLiveBookingForPerson(
    live,
    { phone: person.phone, whatsapp: person.whatsapp ?? null, email: person.email },
    (raw) => normalizeWhatsappNumber(raw),
  );
}

/**
 * "You already have a call booked", worded for whether a WhatsApp confirmation was actually sent
 * (issue A5). Reads the SAME runtime flag that gates the confirmation itself, so the sentence
 * cannot point somebody at a message that never left.
 *
 * Resolved here rather than at module scope because `getWatiRuntime` reads AppSetting - the
 * founder can pause WhatsApp without a deploy, and this answer has to follow that.
 */
async function alreadyBookedError(): Promise<{ ok: false; error: string }> {
  const wati = await getWatiRuntime().catch(() => null);
  return {
    ok: false,
    error: alreadyBookedMessage({
      whatsappArmed: wati?.enabled === true,
      contactNumber: AGREEMENT_PROVIDER.mobile,
      contactEmail: AGREEMENT_PROVIDER.email,
    }),
  };
}

/**
 * `declined` marks the auto-disqualify path: the intake was stored, but NO slot was claimed.
 * The prospect-facing page needs to know, because "we saved your answers" and "you have a call
 * on Wednesday" are different sentences and only one of them is true here.
 */
export type BookingSubmitResult = { ok: true; declined?: boolean } | { ok: false; error: string };

/**
 * ════════════════════════════════════════════════════════════════════════════════════════
 *  NO SLOTS OPEN - CAPTURE THE PERSON ANYWAY  (issue A6)
 * ════════════════════════════════════════════════════════════════════════════════════════
 *
 * `/book` renders an empty calendar whenever the availability engine is unarmed or the diary has
 * simply run dry: "No call times are open right now - please check back shortly." Honest, and
 * far better than the four zeroes this screen used to show. But it was still the ONE dead end in
 * the app whose victim cannot be told to ask an admin - a stranger who clicked a paid ad, is
 * ready to talk to us, and leaves with no `Lead` row created at all.
 *
 * `server/not-armed.ts` records that exact failure on production: "no availability pattern → 0
 * slots, 0 bookings, an empty public /book calendar". Arming availability is the real fix; this
 * is the safety net for every future lapse, and it costs the prospect four fields.
 *
 * ── Why DISCO_NOT_BOOKED and not NEW_LEAD ───────────────────────────────────────────────
 * That stage exists for precisely this person: known to us, wanted a discovery call, hasn't got
 * one. It puts them on the specialist desks' chase lists instead of the bottom of the new-lead
 * pile, and it is what the Outreach SOP's ladder reads to keep working on them. Filing them as
 * NEW_LEAD would discard the single most valuable thing we know - that they tried to book.
 *
 * ── Why this cannot claim a slot, ever ──────────────────────────────────────────────────
 * It does not touch `AppointmentSlot` and shares none of `submitBooking`'s claiming path. A
 * slot released a second after this submission must be offered by the team (or by
 * `promoteIntoFreedSlot`), not silently taken by whoever happened to be on the page - the
 * prospect agreed to be contacted, not to a time they never saw.
 */
const noSlotsSchema = z.object({
  name: rule("name"),
  /**
   * REQUIRED, unlike on some other intake paths. `upsertIntakeLead` accepts a null phone for
   * workshop sign-ups, but every lead webhook 422s a phone-less lead and the whole point of this
   * capture is that somebody can be chased - a row nobody can call is not a saved lead, it is a
   * record that we lost one.
   */
  phone: rule("phone"),
  email: optionalRule("email"),
  /** Prose. Optional, because a required "why" on a four-field apology form is a fifth reason to leave. */
  note: optionalRule("text"),
  /**
   * Same shape as `bookingSchema`'s: optional in the SCHEMA, mandatory in the ACTION below.
   *
   * An unticked checkbox posts nothing at all, so a `z.literal` here would reject it as a
   * malformed submission ("please check the details you entered") rather than as the refusal it
   * actually is. The explicit test after parsing gets to say the true sentence.
   */
  consent: z.string().optional(),
});

export async function submitNoSlotsInterest(form: FormData): Promise<ActionResult> {
  /**
   * Rated as a FORM, not as a booking. It consumes no calendar slot, so the tight `bookPerIp`
   * rule would be punishing the wrong thing - but it is still an unauthenticated write that can
   * fire an intro message, so it is not unrated either.
   */
  const hdrs = await Promise.resolve(headers());
  const ip = clientIpFrom(hdrs);
  const gate = takeTokens([
    { key: `noslots:ip:${ip}`, rule: RATE_RULES.formPerIp },
    { key: "noslots:global", rule: RATE_RULES.formGlobal },
  ]);
  if (!gate.ok) {
    return { ok: false, error: "Too many attempts - please try again in a few minutes." };
  }

  const parsed = noSlotsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the details you entered." };
  }
  const d = parsed.data;

  /**
   * "No lead data is stored without explicit consent" - the same rule `submitBooking` enforces,
   * enforced here too rather than inherited. This is a SECOND public path into
   * `upsertIntakeLead`, and the moment one of them skips this test the rule stops being a
   * property of the app and becomes a property of one action.
   */
  if (d.consent !== CONSENT_VALUE) {
    return { ok: false, error: "Please tick the box so we may store your details and contact you." };
  }

  /**
   * Already holds a live call? Say so and write nothing.
   *
   * Reusing the booking collision check keeps one answer to "this person is already in the
   * diary", and stops a prospect whose confirmation has not arrived yet from filing themselves
   * as un-booked and landing on a chase list they do not belong on.
   */
  if (await liveBookingFor(prisma, { phone: d.phone, email: d.email ?? "" })) {
    return alreadyBookedError();
  }

  const res = await upsertIntakeLead(
    {
      name: d.name,
      phone: d.phone,
      email: d.email ?? null,
      // No "how did you hear about us" on a four-field form, and guessing it would write a
      // marketing attribution nobody stated. LANDING_PAGE is what `submitBooking` falls back to
      // for the same reason.
      leadSource: LeadSource.LANDING_PAGE,
      source: "BOOKING_FORM" as const,
      notes: d.note ?? null,
      originDomain: await observedOriginDomain(),
      consent: {
        // Stored VERBATIM as shown - see lib/consent.ts. A different form means a different
        // sentence, not the booking one.
        purpose: CONSENT_LABEL_NO_SLOTS,
        policyVersion: CONSENT_POLICY_VERSION,
        source: "BOOKING_FORM" as const,
        ipAddress: ip === "unknown" ? null : ip,
        userAgent: hdrs.get("user-agent"),
      },
    },
    // It IS an opt-in form rather than a booking, so a returning prospect gets the New Lead
    // stage message - the behaviour `announceReturningOptIn` exists for.
    { announceReturning: true },
  );

  /**
   * Stage, set only FORWARD and only from the early funnel.
   *
   * Somebody who is already at SSS_BOOKED or WON must not be dragged back to "wanted a call" by
   * filling in this form - that would rewrite a real pipeline position on the strength of a
   * stranger re-typing a phone number. `NEW_LEAD` and `WHATSAPP_SENT` are the only stages this
   * is an advance on; `DISCO_NOT_BOOKED` itself is excluded so a second submission is a no-op.
   */
  const ADVANCE_FROM: LeadStage[] = ["NEW_LEAD", "WHATSAPP_SENT"];
  await prisma.lead
    .updateMany({
      where: { id: res.lead.id, stage: { in: ADVANCE_FROM } },
      data: { stage: "DISCO_NOT_BOOKED" },
    })
    .catch((e) => {
      // Never fail the capture over the stage - the lead row is the thing worth keeping.
      console.error(`[book] no-slots stage update failed for lead ${res.lead.id}`, e);
    });

  return { ok: true };
}

export async function submitBooking(form: FormData): Promise<BookingSubmitResult> {
  // Public endpoint, and the most expensive one here: a submission consumes a finite calendar
  // slot AND fires a WATI confirmation. Two dimensions, charged atomically:
  //
  //   per-IP    5 burst then 5 / 10 min - generous for a human correcting form errors, and
  //             tight enough that one client can't exhaust the open slots.
  //   global    40 burst then 40 / 10 min - the per-IP rule does nothing against a hundred
  //             IPs each politely taking their allowance until the calendar is empty. The
  //             booking diary is a shared resource, so it needs a shared ceiling.
  //
  // The global bucket sits well above any plausible real day (the calendar top-up ships a
  // handful of slots a week), so it only ever bites during an attack.
  const hdrs = await Promise.resolve(headers());
  const ip = clientIpFrom(hdrs);
  const gate = takeTokens([
    { key: `book:ip:${ip}`, rule: RATE_RULES.bookPerIp },
    { key: "book:global", rule: RATE_RULES.bookGlobal },
  ]);
  if (!gate.ok) {
    return { ok: false, error: "Too many booking attempts - please try again in a few minutes." };
  }
  const userAgent = hdrs.get("user-agent");

  const parsed = bookingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  if (d.company_website) return { ok: true }; // honeypot tripped - silently drop

  // ── Consent gate (spec §15, §19.1-C1) ────────────────────────────────────────
  // "No lead/student data is stored without explicit consent" - GDPR, and our prospects are
  // in Germany and India. This sits ABOVE every write below: both the auto-disqualify branch
  // and the booked branch call upsertIntakeLead, so refusing here is what makes "no consent,
  // no row" true of the whole action rather than of one path.
  //
  // Fails CLOSED. A tampered POST, or a stale page cached from before this field existed,
  // posts no consent and is refused - the safe direction for a rule about not storing people.
  if (d.consent !== CONSENT_VALUE) {
    return { ok: false, error: "Please tick the consent box so we can store your details and contact you." };
  }

  /**
   * ── One live discovery call per person ────────────────────────────────────────
   * On 17/09/2026 one number held two live bookings, and every confirmation and reminder went
   * out twice - each booking ran its own clock, and nothing could say which call was real.
   *
   * A second submission is REFUSED, not treated as a reschedule. Both were considered; refusing
   * wins on every count the founder cares about here: it sends nothing (a reschedule sends a
   * "your call moved" notice), it never moves an existing appointment on the strength of a form
   * that might have been filled by someone else sharing the number, and the one booking that
   * exists stays the single source of truth. Moving a call stays a deliberate act by the team,
   * who can see both the booking and the message this returns.
   *
   * Checked HERE, before anything is written: the auto-disqualify branch below would otherwise
   * move a live booker's lead to LOST and close their journey on the strength of a duplicate
   * form. Re-checked inside the claiming transaction for the race between two open tabs.
   */
  if (await liveBookingFor(prisma, d)) {
    return alreadyBookedError();
  }

  const rules = await getBookingRulesConfig();
  /**
   * The verdict, from whichever scorer the founder has selected (Console → Qualification).
   *
   * Was `computeBant(d)` with the catalogue running alongside it and being ignored. Now one call
   * decides and reports which scorer answered - and falls back to the shipped tables on any
   * failure, because the alternative on this path is rejecting a prospect over a config error.
   */
  const scored = await scoreSubmission(d);
  const bant = scored.result;
  const utm = d.utm ? sanitizeUtm(d.utm) : null;

  // The evidence half of the gate above. Written inside whichever transaction ends up
  // persisting this prospect, so a booking can never commit without its consent row: the
  // proof and the data it authorises land together or not at all.
  //
  // `region` stays null deliberately. Spec §15 asks for it, but the form has no country
  // field and `city` is free text - deriving "DE" from a typed city name would be a guess
  // recorded as a fact, which is worse than an honest blank. Needs a country field to fill.
  const consentFor = (leadId: string) => ({
    leadId,
    granted: true,
    purpose: CONSENT_LABEL,
    policyVersion: CONSENT_POLICY_VERSION,
    region: null,
    source: "BOOKING_FORM" as const,
    ipAddress: ip,
    userAgent: userAgent ? userAgent.slice(0, 500) : null,
  });

  // BOOKING_FORM provenance; channel from "how did you hear about us", default LANDING_PAGE.
  const leadInput = {
    name: d.name,
    phone: d.phone,
    email: d.email,
    city: clean(d.city),
    leadSource: (d.howKnowUs && HOW_TO_CHANNEL[d.howKnowUs]) || LeadSource.LANDING_PAGE,
    source: "BOOKING_FORM" as const,
    utm,
    notes: clean(d.reasonForCall),
    // Observed from this request, so a prospect who books through the funnel carries the host
    // they booked on. Only fills a blank - see `acceptReturningOptIn`.
    originDomain: await observedOriginDomain(),
  };

  // The qualification answers + BANT, shared by the booked AND the auto-disqualified paths so
  // the two record the same intake data and can never drift apart.
  const bookingFields = {
    name: d.name,
    email: d.email,
    phone: d.phone,
    whatsapp: clean(d.whatsapp),
    city: clean(d.city),
    currentJobTitle: clean(d.currentJobTitle),
    prospectIndustry: clean(d.prospectIndustry),
    linkedInProfile: clean(d.linkedInProfile),
    highestEducation: clean(d.highestEducation),
    yearsExperience: clean(d.yearsExperience),
    whyGermany: clean(d.whyGermany),
    participateWorkshop: d.participateWorkshop === "yes",
    reasonForCall: clean(d.reasonForCall),
    alreadyApplied: clean(d.alreadyApplied),
    whenStartGermany: clean(d.whenStartGermany),
    germanVisa: clean(d.germanVisa),
    germanLevel: clean(d.germanLevel),
    willingnessLearnGerman: clean(d.willingnessLearnGerman),
    currentIncome: clean(d.currentIncome),
    readyToInvest: clean(d.readyToInvest),
    decisionMaking: clean(d.decisionMaking),
    commitment: clean(d.commitment),
    howKnowUs: clean(d.howKnowUs),
    ...bant,
    // ER v2 Track D - SHADOW ONLY. What the configurable question catalogue would have
    // scored this submission. Recorded beside the live verdict and read by nothing: the
    // decision below still comes from `bant`, exactly as it did before the catalogue
    // existed. `scoreSubmission` swallows its own errors and falls back to the shipped
    // tables, because a scoring failure that could reject a prospect is worse than an
    // unrecorded measurement. Which scorer is live is set in Console → Qualification.
    bantShadowAvg: scored.shadowAvg,
    bantConfigVersion: scored.configVersion,
  };

  // ── Auto-disqualify ──────────────────────────────────────────────────────────
  // A BANT "CANCEL" verdict (weighted avg < 2) means the prospect does not qualify. Per the
  // sales rule, don't hold a call: record the intake as a CANCELLED booking WITHOUT claiming a
  // slot (it stays OPEN for a qualified prospect), move the lead to LOST with an audited reason,
  // and send the polite rejection template. Founder-gated (default on). The email is still
  // behind the Resend seam, so with email off it's logged SKIPPED - never sent unconfigured.
  if (rules.autoDisqualify && bant.bantVerdict === "CANCEL") {
    const { lead } = await upsertIntakeLead(leadInput);
    await prisma.$transaction(async (tx) => {
      await tx.consentRecord.create({ data: consentFor(lead.id) });
      await tx.bookingRequest.create({
        data: { leadId: lead.id, ...bookingFields, status: "CANCELLED" },
      });
      const fresh = await tx.lead.findUnique({
        where: { id: lead.id },
        select: { stage: true, notes: true },
      });
      if (fresh && fresh.stage !== "LOST") {
        const reason = `Auto-disqualified at intake - BANT ${bant.bantAvg.toFixed(1)}/4`;
        await tx.lead.update({
          where: { id: lead.id },
          data: { stage: "LOST", notes: fresh.notes ? `${fresh.notes} · ${reason}` : reason },
        });
        await tx.leadStageHistory.create({
          data: { leadId: lead.id, fromStage: fresh.stage, toStage: "LOST" },
        });
        await syncDefaultOpportunity(tx, lead.id, "LOST");
      }

      // Close the SOP journey too (Step 17 - NO → terminal). A BANT CANCEL is a "Not Qualified"
      // verdict, so record it and move the journey to IGNORED; otherwise a disqualified prospect
      // would sit in the active outreach queue being chased forever. The CANCELLED booking is
      // deliberately NOT linked (bookingId stays null): the engine's cross-check excludes CANCELLED
      // bookings, and Key Metrics is a booked-prospects surface - a LOST lead doesn't belong there.
      const journey = await tx.outreachJourney.findUnique({
        where: { leadId: lead.id },
        select: { id: true, qualified: true, phase: true },
      });
      if (journey && journey.qualified === null) {
        await tx.outreachJourney.update({
          where: { id: journey.id },
          data: {
            qualified: "NO",
            qualifiedAt: new Date(),
            bantScoreAtQual: bant.bantAvg,
            phase: "IGNORED",
            ignoredAt: new Date(),
          },
        });
      }
    });

    // Application Logic §4.3 stage 2 - the booking form's verdict supersedes whatever the
    // landing page scored at opt-in. Mirrored even on the disqualify path: "why was this lead
    // closed" is answered by the score that closed it, and reading it off the Lead is what every
    // pipeline surface does.
    await mirrorBookingScoreToLead(lead.id, bant);

    // Founder-editable rejection template; renders {{name}} tokens and logs a Message row.
    // Never let an email failure surface into the prospect's submit result.
    try {
      await sendEmailMessage({ leadId: lead.id, subject: rules.rejectionSubject, body: rules.rejectionBody });
    } catch {
      /* email is best-effort */
    }

    revalidatePath("/bookings");
    revalidatePath("/book");
    return { ok: true, declined: true };
  }

  // ── Qualified / doubt / confirm - book the slot ───────────────────────────────
  // Slot must exist, be OPEN, and sit inside the founder's booking window (min notice from
  // now, max advance out) - same rules the public page used to filter its slot list, checked
  // again here in case the page was left open a while or the config changed since it loaded.
  const now = Date.now();
  const earliestBookable = now + rules.minNoticeHours * 3_600_000;
  const latestBookable = now + rules.maxAdvanceDays * 86_400_000;
  const slot = await prisma.appointmentSlot.findUnique({ where: { id: d.slotId } });
  if (
    !slot ||
    slot.status !== "OPEN" ||
    slot.startsAt.getTime() <= earliestBookable ||
    slot.startsAt.getTime() > latestBookable
  ) {
    return { ok: false, error: "That time was just taken - please pick another slot." };
  }

  // Lead first (its own transaction inside the helper).
  const { lead } = await upsertIntakeLead(leadInput);

  // Claim the slot + create the booking + advance the lead to DISCO_BOOKED atomically.
  // updateMany with a status guard is the concurrency lock against a double-book.
  let bookingId: string;
  try {
    bookingId = await prisma.$transaction(async (tx) => {
      // The same person-level rule as above, re-read at the last moment before the claim. It
      // closes the gap of a second tab submitted while this one was scoring and upserting; two
      // submissions committing in the same few milliseconds could still both pass (there is no
      // per-person lock), and would then show as a visible pair on the Bookings page.
      if (await liveBookingFor(tx, d)) throw new Error("ALREADY_BOOKED");

      const claim = await tx.appointmentSlot.updateMany({
        where: { id: slot.id, status: "OPEN" },
        data: { status: "BOOKED" },
      });
      if (claim.count === 0) throw new Error("SLOT_TAKEN");

      await tx.consentRecord.create({ data: consentFor(lead.id) });

      const booking = await tx.bookingRequest.create({
        select: { id: true },
        data: { slotId: slot.id, leadId: lead.id, ...bookingFields },
      });

      /**
       * A booked call = STRATEGY_CALL_BOOKED, the board's "Discovery Call Booked" column.
       *
       * This used to jump straight to DISCO_BOOKED ("Pre-Qualified & Confirmed"), which claimed
       * the prospect had been qualified AND their call confirmed the instant they picked a slot -
       * neither of which has happened yet. Qualification moves them on from here.
       *
       * The guard is a HOLD list rather than an allow list. It used to advance only NEW_LEAD and
       * WHATSAPP_SENT, so a prospect who already existed in any OTHER stage booked a call and the
       * board did not move at all - the 8,086 leads sitting in Cancelled/Unqualified could each
       * book a discovery call and stay filed as written off. Someone who was given up on and comes
       * back to book is the single most valuable card on the board, and it was invisible.
       *
       * Inverting it also means a stage added later advances by default, which is the safe
       * direction: a missing early stage silently strands prospects, while a missing late stage
       * would announce itself immediately by dragging a paying customer backwards.
       */
      const fresh = await tx.lead.findUnique({ where: { id: lead.id }, select: { stage: true } });
      if (fresh && !HOLDS_THROUGH_BOOKING.has(fresh.stage)) {
        await tx.lead.update({ where: { id: lead.id }, data: { stage: "STRATEGY_CALL_BOOKED" } });
        await tx.leadStageHistory.create({
          data: { leadId: lead.id, fromStage: fresh.stage, toStage: "STRATEGY_CALL_BOOKED" },
        });
        /**
         * ...and carry the board card with it.
         *
         * Every other path that moves a lead's stage calls this (call logs, discovery routing,
         * automation, the auto-stage rules); booking was the one that did not, so a confirmed
         * discovery call left its card sitting in "WhatsApp Sent". The lead record said booked
         * and the board said not booked, and the team works from the board - observed on a real
         * booking on 20 Aug 2026.
         */
        await syncDefaultOpportunity(tx, lead.id, "STRATEGY_CALL_BOOKED");
      }

      // SOP Steps 10-11, synchronously. A prospect who books directly on the public form would
      // otherwise stay unlinked from their booking - the ONLY thing that links the two is the
      // async engine's Step 10 cross-check, and that engine is off by default. So without this,
      // a booked prospect's BANT score never reaches the Qualified verdict (Step 11) or Key
      // Metrics (Step 12): the outreach tab shows them as "not booked" while /bookings shows them
      // booked. Link the journey here and derive Qualified from BANT - the same pure function the
      // engine uses, so the two paths can never disagree. Guarded so it can't clobber a link or a
      // human's prior verdict; a lead created outside intake (manual back-office entry) may have no
      // journey, which is fine - updateMany-style tolerance via the null check.
      const journey = await tx.outreachJourney.findUnique({
        where: { leadId: lead.id },
        select: { id: true, bookingId: true, qualified: true },
      });
      if (journey && journey.bookingId === null) {
        const verdict = qualifiedFromBant(bant.bantAvg);
        await tx.outreachJourney.update({
          where: { id: journey.id },
          data: {
            bookingId: booking.id,
            ...(journey.qualified === null && verdict
              ? { qualified: verdict, qualifiedAt: new Date(), bantScoreAtQual: bant.bantAvg }
              : {}),
          },
        });
      }
      return booking.id;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "SLOT_TAKEN") {
      return { ok: false, error: "That time was just taken - please pick another slot." };
    }
    if (e instanceof Error && e.message === "ALREADY_BOOKED") {
      return alreadyBookedError();
    }
    throw e;
  }

  /**
   * The booking is COMMITTED at this point. Everything below is downstream of it, and used to be
   * charged to the person who had just picked a slot: a score mirror, the automation engine run
   * inline (every send step of every BOOKING_CREATED workflow), and a WhatsApp confirmation with
   * a 12-second ceiling of its own. At ~310ms per cross-region round trip (see
   * `after-response.ts`) that turned "your call is booked" into a long, blank wait for a
   * decision that had already been made.
   *
   * Deferred as ONE sequential block, in the original order - the confirmation message reads
   * fields the mirror may have just written, and the two must not race each other onto the Lead.
   *
   * Safe to lose to a restart in exactly the way the old comments already describe: the mirror is
   * a convenience copy of what `BookingRequest` authoritatively holds, an enrollment keeps its
   * `nextRunAt` for `runDueWorkflows()`, and an unsent confirmation is re-attempted by the
   * booking automation tick.
   */
  const bookedLeadId = lead.id;
  afterResponse(`booking:${bookingId}`, async () => {
    // Application Logic §4.3 stage 2 - the fuller booking intake supersedes the landing page's
    // opt-in score on the Lead. Outside the transaction: the authoritative copy is already
    // committed on `BookingRequest`, so this is a convenience mirror for the pipeline surfaces
    // and must not be able to roll a confirmed booking back.
    await mirrorBookingScoreToLead(bookedLeadId, bant);

    // Tell the automation engine a booking happened, the same way moveOpportunity fires
    // STAGE_CHANGED after its own transaction commits. Previously nothing called this for a
    // booking, so BOOKING_CREATED workflows could never enroll a single contact.
    await emitTrigger("BOOKING_CREATED", { leadId: bookedLeadId });

    /**
     * Create the Zoom meeting BEFORE the confirmation goes out, not after.
     *
     * No approved WATI template carries a meeting link today, so today the order is invisible.
     * It stops being invisible the moment one does: a confirmation sent first would be the one
     * message the prospect actually reads, and it would be the one without the link in it.
     *
     * Silent and harmless when Zoom is unarmed; a failure here leaves the booking untouched and
     * `sweepZoomMeetings` fills the link in on the next tick.
     */
    await syncBookingMeeting(bookingId);

    // Wave-2: fire the WhatsApp booking confirmation. No-op (and writes no row) unless WATI is
    // configured + enabled; it never throws, so it can't affect the booking result.
    await sendBookingConfirmation(bookingId);
  });

  revalidatePath("/bookings");
  revalidatePath("/book");
  return { ok: true };
}

// ─────────────────────────── Admin: slot + booking management ───────────────────────────

const slotGenSchema = z.object({
  startDate: z.string().min(10, "Pick a start date"),
  endDate: z.string().min(10, "Pick an end date"),
  weekdays: z.array(z.enum(WEEKDAY_KEYS)).min(1, "Pick at least one day of the week"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Start time HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "End time HH:MM"),
  intervalMins: z.coerce.number().int().min(15).max(240),
  durationMins: z.coerce.number().int().refine((v) => v === 30 || v === 60, "Choose a call type"),
  // Optional Select, populated from active Users; blank = unassigned.
  assignedToId: z.string().trim().max(64).optional(),
});

/**
 * Admin generates OPEN slots across an IST time window (e.g. 15:00-18:00 every 30m), applied
 * to every date in [startDate, endDate] that falls on one of the chosen weekdays - a one-time
 * batch expansion of the original single-date generator (§9), not a persisted recurring rule.
 */
export async function generateSlots(form: FormData): Promise<ActionResult> {
  const session = await requireSection("bookings");
  // FormData can carry multiple "weekdays" entries (one per checked checkbox);
  // Object.fromEntries would silently keep only the last one, so pull it separately.
  const weekdays = form.getAll("weekdays").map(String);
  const parsed = slotGenSchema.safeParse({ ...Object.fromEntries(form), weekdays });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const startDateObj = parseDateInput(d.startDate);
  const endDateObj = parseDateInput(d.endDate);
  if (endDateObj.getTime() < startDateObj.getTime()) {
    return { ok: false, error: "End date must be on or after the start date" };
  }
  const daySpan = Math.round((endDateObj.getTime() - startDateObj.getTime()) / 86_400_000);
  if (daySpan > 180) return { ok: false, error: "Keep the date range under 6 months" };

  // The time-of-day window is the same on every matching date - validate it once against a
  // reference day instead of re-checking per iteration below.
  if (istWallToUtc(d.startDate, d.endTime).getTime() <= istWallToUtc(d.startDate, d.startTime).getTime()) {
    return { ok: false, error: "End time must be after start time" };
  }

  const rules = await getBookingRulesConfig();

  // Shared with the daily `ensureBookingSlots` cron so a hand-generated range and an
  // auto-topped-up horizon land on exactly the same instants and dedupe against each other.
  const starts = slotStartsForRange({
    startDate: d.startDate,
    endDate: d.endDate,
    pattern: d,
    bufferMinutes: rules.bufferMinutes,
    istWallToUtc,
    parseDate: parseDateInput,
    formatDate: toDateInputValue,
  });
  if (!starts.length) {
    return { ok: false, error: "That window fits no slots - widen it, add weekdays, or shorten the duration" };
  }

  // Skip any instant that already has a slot, so re-running a range is idempotent - same
  // dedupe the original single-date generator used, just against the wider `starts` list.
  const existing = await prisma.appointmentSlot.findMany({
    where: { startsAt: { in: starts } },
    select: { startsAt: true },
  });
  const taken = new Set(existing.map((s) => s.startsAt.getTime()));
  const fresh = starts.filter((s) => !taken.has(s.getTime()));
  if (fresh.length) {
    await prisma.appointmentSlot.createMany({
      data: fresh.map((startsAt) => ({
        startsAt,
        durationMins: d.durationMins,
        assignedToId: d.assignedToId || null,
      })),
    });
    // createMany returns no ids and a re-run is idempotent, so the batch itself is the
    // entity here - "batch" can never collide with a real slot's cuid.
    await logActivity(session, {
      action: "slot.create",
      section: "bookings",
      entityType: "AppointmentSlot",
      entityId: "batch",
      summary: `Generated ${fresh.length} ${d.durationMins}-minute slots from ${d.startDate} to ${d.endDate}`,
      meta: {
        created: fresh.length,
        skippedExisting: starts.length - fresh.length,
        startDate: d.startDate,
        endDate: d.endDate,
        weekdays: d.weekdays,
        startTime: d.startTime,
        endTime: d.endTime,
        durationMins: d.durationMins,
        assignedToId: d.assignedToId || null,
      },
    });
  }

  revalidatePath("/bookings");
  return { ok: true };
}

const bookingRulesFormSchema = z.object({
  bufferMinutes: z.coerce.number().int().min(0).max(240),
  minNoticeHours: z.coerce.number().int().min(0).max(240),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
  // The confirmation loop's three windows arrive as duration strings ("3h", "45m") and are
  // parsed below; the toggles are read separately too, because an unchecked HTML checkbox
  // submits nothing at all.
  // The rejection template. Bounds mirror `bookingRulesConfigSchema` so the form cannot store a
  // value the config would later refuse and coerce away.
  rejectionSubject: z.string().trim().min(1).max(200),
  rejectionBody: z.string().trim().min(1).max(4000),
});

/** Admin edits the slot window + the confirmation-loop cadence/toggles (AppSetting). */
export async function updateBookingRules(form: FormData): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const parsed = bookingRulesFormSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  // Merged over the current config so a key this form does not carry is preserved rather than
  // reset to its shipped default.
  const current = await getBookingRulesConfig();
  const next = {
    ...current,
    ...parsed.data,
    autoCancelEnabled: form.get("autoCancelEnabled") === "on",
    promoteNext: form.get("promoteNext") === "on",
    // Unreadable duration → keep what is stored. These decide when a real prospect's call is
    // released, so a typo must not silently snap them back to the shipped defaults.
    confirmRequestLeadMinutes: coerceDurationMinutes(form.get("confirmRequestLead"), current.confirmRequestLeadMinutes),
    autoCancelMinutes: coerceDurationMinutes(form.get("autoCancelWindow"), current.autoCancelMinutes),
    confirmReplyGraceMinutes: Math.max(
      5,
      coerceDurationMinutes(form.get("confirmReplyGrace"), current.confirmReplyGraceMinutes, 1440),
    ),
    // Read separately for the same reason as the two above: an unchecked HTML checkbox submits
    // nothing at all, so `?? current` would keep it stuck on forever once enabled.
    autoDisqualify: form.get("autoDisqualify") === "on",
  };
  // Validate the full merged config - including the "ask lead > cancel window" refinement - before
  // persisting; an invalid combo would otherwise coerce back to defaults on the next read.
  const valid = bookingRulesConfigSchema.safeParse(next);
  if (!valid.success) return { ok: false, error: firstError(valid.error) };
  await writeBookingRulesConfig(valid.data);
  const diff = diffFields<Record<string, unknown>>(current, valid.data);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "booking.rules.update",
      section: "bookings",
      entityType: "AppSetting",
      entityId: BOOKING_RULES_KEY,
      summary: `Updated the booking rules - changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/bookings");
  revalidatePath("/book");
  return { ok: true };
}

/**
 * Save ONLY the confirm-or-cancel block - the Console door onto the same rule.
 *
 * Separate from `updateBookingRules` because that one validates the whole Booking-rules form
 * (buffer, notice, advance window, the rejection template) and would refuse a submission that
 * carries none of them. Both merge over the stored config, so neither can reset what the other
 * owns.
 */
export async function saveConfirmLoopRules(form: FormData): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const res = await prepareConfirmLoopSave(form, session, "the Console");
  if (!res.ok) return { ok: false, error: res.error };
  if (res.write) await res.write();
  return { ok: true };
}

/** Delete an OPEN or BLOCKED slot (a BOOKED slot must be cancelled via the booking first). */
export async function deleteSlot(id: string): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const slot = await prisma.appointmentSlot.findUnique({ where: { id }, select: { status: true, startsAt: true } });
  if (!slot) return { ok: false, error: "Slot not found" };
  if (slot.status === "BOOKED") return { ok: false, error: "Cancel the booking before removing this slot" };
  await prisma.appointmentSlot.delete({ where: { id } });
  await logActivity(session, {
    action: "slot.delete",
    section: "bookings",
    entityType: "AppointmentSlot",
    entityId: id,
    summary: `Removed the ${activityStamp(slot.startsAt)} slot`,
    meta: { startsAt: slot.startsAt, status: slot.status },
  });
  revalidatePath("/bookings");
  return { ok: true };
}

const BOOKING_STATUSES = ["BOOKED", "RESCHEDULED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const;

/**
 * Admin sets a booking's outcome. CANCELLED / NO_SHOW free the slot back to OPEN AND detach the
 * booking from it (nulling the unique slotId) so the slot is cleanly re-bookable - leaving the old
 * booking attached would collide the next time that slot is booked. NO_SHOW also moves the lead to
 * NO_SHOW for the pipeline's deal-risk view. On a CANCELLED, the freed slot is offered to the next
 * same-caller/same-day call (promote-next), if that toggle is on.
 */
export async function setBookingStatus(id: string, status: string): Promise<ActionResult> {
  const session = await requireSection("bookings");
  if (!(BOOKING_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Invalid status" };
  }
  const booking = await prisma.bookingRequest.findUnique({
    where: { id },
    // `slot.startsAt` decides whether the freed slot is genuinely re-bookable (M2).
    select: {
      slotId: true, leadId: true, name: true, status: true,
      slot: { select: { startsAt: true, durationMins: true } },
    },
  });
  if (!booking) return { ok: false, error: "Booking not found" };

  const freesSlot = (status === "CANCELLED" || status === "NO_SHOW") && !!booking.slotId;

  /**
   * M2: a freed slot only returns to availability if someone could actually take it.
   *
   * The public booking form refuses anything inside `minNoticeHours`, so releasing a slot that
   * starts in one hour used to publish a slot nobody can book - the calendar showed capacity
   * that did not exist, and the founder had no way to tell the difference. Inside the notice
   * window the slot is BLOCKED instead: still not sold, but honestly marked as unusable.
   *
   * The cancellation itself is never refused. Spec §M2 frames this as "require cancellation
   * 12-24 hours before", but blocking a late cancel would force a call that is not happening to
   * stay marked BOOKED - which corrupts the show-rate the L2 desk reports on. Recording reality
   * beats enforcing a policy the calendar cannot undo.
   */
  const rules = await getBookingRulesConfig();
  const freedSlotStatus = releasedSlotStatus(booking.slot?.startsAt ?? null, rules.minNoticeHours);

  await prisma.$transaction(async (tx) => {
    await tx.bookingRequest.update({
      where: { id },
      data: {
        status: status as (typeof BOOKING_STATUSES)[number],
        ...(freesSlot ? { slotId: null } : {}),
      },
    });

    if (freesSlot && booking.slotId) {
      await tx.appointmentSlot.update({ where: { id: booking.slotId }, data: { status: freedSlotStatus } });
      /**
       * Keep the cancellation visible after the fact. Detaching `slotId` just above is what makes
       * the slot re-bookable AND what erases the booking's own time - the table rendered "-" where
       * it used to be. This row is the only remaining record that this slot was sold and given
       * back, and it is what Bookings → Cancelled slots lists.
       */
      await recordSlotRelease(tx, {
        slotId: booking.slotId,
        bookingRequestId: id,
        slotStartsAt: booking.slot?.startsAt ?? new Date(),
        durationMins: booking.slot?.durationMins ?? 30,
        prospectName: booking.name,
        reason: status === "NO_SHOW" ? "NO_SHOW" : "CANCELLED",
        releasedStatus: freedSlotStatus,
        releasedByName: session.user.name?.trim() || session.user.email || "Unknown user",
      });
    }
    if (status === "NO_SHOW" && booking.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: booking.leadId }, select: { stage: true } });
      if (lead && lead.stage !== "NO_SHOW") {
        await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "NO_SHOW" } });
        await tx.leadStageHistory.create({
          data: { leadId: booking.leadId, fromStage: lead.stage, toStage: "NO_SHOW" },
        });
        // Same reason as the booked path - the board must not keep claiming they are coming.
        await syncDefaultOpportunity(tx, booking.leadId, "NO_SHOW");
      }
    }
  });

  const diff = diffFields<Record<string, unknown>>({ status: booking.status }, { status });
  if (diff.changed.length) {
    await logActivity(session, {
      action: "booking.update",
      section: "bookings",
      entityType: "BookingRequest",
      entityId: id,
      summary: `Marked ${booking.name}'s booking ${status}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after, slotFreed: freesSlot },
    });
  }

  /**
   * The call is off, so the room should be too. The reconciler decides: it deletes the meeting
   * for a cancellation or a no-show, and does nothing at all for a status that keeps the call
   * live. Deliberately after the transaction - a Zoom timeout must never roll back the fact that
   * somebody cancelled.
   */
  await syncBookingMeeting(id);

  // Fill the freed slot with the next waiting call for the same caller on the same day.
  if (status === "CANCELLED" && booking.slotId) {
    const rules = await getBookingRulesConfig();
    if (rules.promoteNext) await promoteIntoFreedSlot(booking.slotId, session.user.id);
  }

  revalidatePath("/bookings");
  revalidatePath("/pipeline");
  return { ok: true };
}

// ─────────────────────────── Admin: block / reschedule / confirm ───────────────────────────

/** Manually take a slot out of (or back into) availability. A BOOKED slot can't be blocked. */
export async function setSlotBlocked(id: string, blocked: boolean): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const slot = await prisma.appointmentSlot.findUnique({ where: { id }, select: { status: true, startsAt: true } });
  if (!slot) return { ok: false, error: "Slot not found" };
  if (slot.status === "BOOKED") return { ok: false, error: "Cancel the booking before blocking this slot" };
  const next = blocked ? "BLOCKED" : "OPEN";
  if (slot.status === next) return { ok: true }; // already there - no-op
  // Guard the transition so we never blindly flip a slot that changed under us.
  const res = await prisma.appointmentSlot.updateMany({
    where: { id, status: blocked ? "OPEN" : "BLOCKED" },
    data: { status: next },
  });
  if (res.count === 0) return { ok: false, error: "Slot changed - refresh and try again" };
  await logActivity(session, {
    action: blocked ? "slot.block" : "slot.unblock",
    section: "bookings",
    entityType: "AppointmentSlot",
    entityId: id,
    summary: `${blocked ? "Blocked" : "Unblocked"} the ${activityStamp(slot.startsAt)} slot`,
    meta: { changed: ["status"], before: { status: slot.status }, after: { status: next } },
  });
  revalidatePath("/bookings");
  return { ok: true };
}

/**
 * What both reschedule paths need to know about the booking they are moving.
 *
 * `leadId` and the contact columns are here for the slot-LESS case: a call that was cancelled or
 * written off as a no-show holds no slot, and giving it a new time has to carry the lead back onto
 * the board and check the person has not booked again in the meantime.
 */
const BOOKING_MOVE_SELECT = {
  id: true, slotId: true, status: true, name: true, leadId: true,
  phone: true, whatsapp: true, email: true,
  slot: { select: { startsAt: true, durationMins: true, assignedToId: true } },
} satisfies Prisma.BookingRequestSelect;

type BookingToMove = Prisma.BookingRequestGetPayload<{ select: typeof BOOKING_MOVE_SELECT }>;

/** Whoever is doing the moving, as the slot-release log wants it. */
function movedByName(session: AppSession): string {
  return session.user.name?.trim() || session.user.email || "Unknown user";
}

/**
 * Refuse to revive a dead booking when the same person already holds a live one.
 *
 * Only ever asked of a booking that is NOT live: a cancelled or no-show call can be given a new
 * time weeks later, by which point the prospect may well have booked themselves back in - and two
 * live bookings for one person is precisely what `booking-identity` exists to prevent: each runs
 * its own confirmation and its own reminders, and nothing can say which appointment is real.
 */
async function otherLiveBookingBlocks(booking: BookingToMove): Promise<string | null> {
  if (booking.status === "BOOKED") return null; // this booking IS the live one
  const other = await liveBookingFor(prisma, {
    phone: booking.phone,
    whatsapp: booking.whatsapp,
    email: booking.email,
  });
  if (other && other.id !== booking.id) {
    return "This person already has another call booked - move that booking instead.";
  }
  return null;
}

/**
 * The move itself, shared by both paths: point the booking at `newSlotId`, hand back whatever slot
 * it was holding, and reset the confirmation so the prospect re-confirms the NEW time (a fresh
 * confirm-request goes out as that slot approaches).
 *
 * The caller must already have claimed `newSlotId` inside the same transaction.
 */
async function moveBookingOntoSlot(
  tx: Prisma.TransactionClient,
  booking: BookingToMove,
  newSlotId: string,
  releasedByName: string,
): Promise<void> {
  await tx.bookingRequest.update({
    where: { id: booking.id },
    /**
     * `zoomStartsAt: null` means "Zoom is now known-stale". The meeting id is KEPT, so the
     * reconciler moves the existing room rather than creating a second one, and the null is what
     * makes this booking visible to `sweepZoomMeetings` if the reconcile below never runs or
     * fails. Every path that changes a call's time owes this null - it is the one invariant that
     * keeps the calendar and Zoom from drifting apart silently.
     */
    data: { slotId: newSlotId, status: "BOOKED", confirmedAt: null, confirmSentAt: null, zoomStartsAt: null },
  });

  if (booking.slotId) {
    // Hand back the old slot - OPEN only if it is still far enough out to be re-booked.
    const rules = await getBookingRulesConfig();
    const freed = releasedSlotStatus(booking.slot?.startsAt ?? null, rules.minNoticeHours);
    await tx.appointmentSlot.update({ where: { id: booking.slotId }, data: { status: freed } });
    // Recorded as POSTPONED, not cancelled: the call is still happening, just later. Without
    // the row the vacated slot would appear on the calendar as one nobody ever booked.
    await recordSlotRelease(tx, {
      slotId: booking.slotId,
      bookingRequestId: booking.id,
      slotStartsAt: booking.slot?.startsAt ?? new Date(),
      durationMins: booking.slot?.durationMins ?? 30,
      prospectName: booking.name,
      reason: "POSTPONED",
      releasedStatus: freed,
      releasedByName,
    });
  }

  /**
   * A call that was NOT live is coming back, so carry its lead back onto the board with it.
   *
   * Keyed on the status it is coming back FROM, not on whether a slot was held: a no-show can be
   * marked without the slot ever being detached, so "holds no slot" would have missed exactly the
   * rows this is for. The cancel (or the no-show) moved the card to Cancelled/No-show, and leaving
   * it there while the calendar says the call is on is the drift that makes the board
   * untrustworthy. Same HOLD-list guard as a fresh booking, so a prospect already further down the
   * funnel is never dragged backwards.
   */
  if (booking.status !== "BOOKED" && booking.leadId) {
    const fresh = await tx.lead.findUnique({ where: { id: booking.leadId }, select: { stage: true } });
    if (fresh && !HOLDS_THROUGH_BOOKING.has(fresh.stage)) {
      await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "STRATEGY_CALL_BOOKED" } });
      await tx.leadStageHistory.create({
        data: { leadId: booking.leadId, fromStage: fresh.stage, toStage: "STRATEGY_CALL_BOOKED" },
      });
      await syncDefaultOpportunity(tx, booking.leadId, "STRATEGY_CALL_BOOKED");
    }
  }
}

/** Log it, tell the prospect their call moved, refresh the screens. Shared tail of both paths. */
async function afterBookingMoved(
  session: AppSession,
  booking: BookingToMove,
  newSlotId: string,
  newStartsAt: Date,
): Promise<void> {
  const revived = booking.status !== "BOOKED";
  await logActivity(session, {
    action: "booking.reschedule",
    section: "bookings",
    entityType: "BookingRequest",
    entityId: booking.id,
    summary: revived
      ? `Re-booked ${booking.name}'s call for ${activityStamp(newStartsAt)}`
      : `Moved ${booking.name}'s call to ${activityStamp(newStartsAt)}`,
    meta: {
      changed: ["slotId"],
      before: { slotId: booking.slotId, status: booking.status },
      after: { slotId: newSlotId, status: "BOOKED" },
    },
  });

  // Move the Zoom meeting onto the new time before the prospect is told the call moved, so the
  // link they already hold keeps working rather than pointing at the old slot.
  await syncBookingMeeting(booking.id);

  // Intimate the prospect their call moved (best-effort; silent when WhatsApp is off).
  await sendBookingRescheduled(booking.id, session.user.id);
  revalidatePath("/bookings");
  revalidatePath("/pipeline");
}

/**
 * Move a booking onto a slot ALREADY on the calendar: free the old slot, claim the new OPEN
 * one, and reset the confirmation so the prospect re-confirms the NEW time (a fresh confirm-request
 * goes out as that slot approaches). The prospect is told the call moved. Concurrency-guarded
 * against a double-book.
 *
 * A booking that is no longer live (cancelled, or written off as a no-show) is re-bookable here
 * too - it is revived to BOOKED. The team has to be able to put a call back on the calendar for
 * someone who rings to say they can make Thursday after all: the public form refuses that person a
 * second booking by design (`alreadyBookedMessage` tells them to ask us to move it), so if this
 * screen cannot do it, nothing can.
 */
export async function rescheduleBooking(bookingId: string, newSlotId: string): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const booking = await prisma.bookingRequest.findUnique({
    where: { id: bookingId },
    select: BOOKING_MOVE_SELECT,
  });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.slotId === newSlotId) return { ok: false, error: "That's already this booking's slot" };
  const blocked = await otherLiveBookingBlocks(booking);
  if (blocked) return { ok: false, error: blocked };

  const target = await prisma.appointmentSlot.findUnique({ where: { id: newSlotId }, select: { status: true, startsAt: true } });
  if (!target) return { ok: false, error: "That slot no longer exists" };
  if (target.status !== "OPEN") return { ok: false, error: "That slot isn't open - pick another time" };
  if (target.startsAt.getTime() <= Date.now()) return { ok: false, error: "Pick a slot in the future" };

  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.appointmentSlot.updateMany({
        where: { id: newSlotId, status: "OPEN" },
        data: { status: "BOOKED" },
      });
      if (claim.count === 0) throw new Error("SLOT_TAKEN");
      // Points the booking at the new slot first (moving the unique slotId off the old one), then
      // releases the old one.
      await moveBookingOntoSlot(tx, booking, newSlotId, movedByName(session));
    });
  } catch (e) {
    if (e instanceof Error && e.message === "SLOT_TAKEN") {
      return { ok: false, error: "That time was just taken - pick another slot." };
    }
    throw e;
  }

  await afterBookingMoved(session, booking, newSlotId, target.startsAt);
  return { ok: true };
}

const customTimeSchema = z.object({
  bookingId: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time (HH:MM)"),
  durationMins: z.coerce
    .number()
    .int()
    .min(15, "A call has to be at least 15 minutes")
    .max(240, "Keep the call under 4 hours"),
  // Blank = leave the call unassigned, same as the slot generator's picker.
  assignedToId: z.string().trim().max(64).optional(),
});

export type RescheduleToTimeInput = z.input<typeof customTimeSchema>;

/**
 * Reschedule onto a time the team TYPES, creating the slot as it goes.
 *
 * `rescheduleBooking` can only offer slots that already exist, which is the wrong shape for what
 * actually happens: the prospect on the phone says "could we do Thursday at four?" and there is no
 * Thursday-at-four slot on the calendar. The only answer then was to send whoever is on the call
 * to the Availability screen to generate a block of slots - which publishes openings on the
 * PUBLIC booking page that nobody meant to publish - and then come back here. In practice the
 * call got cancelled and the prospect was told to book themselves in again, which the identity
 * guard then refuses them.
 *
 * The slot is created BOOKED, never OPEN, so it is this prospect's time and nobody else's. An
 * OPEN slot already sitting at exactly that instant and length is claimed instead of shadowed
 * with a duplicate, so the calendar never shows the same time twice.
 *
 * The booking rules (minimum notice, maximum advance, buffer) deliberately do NOT apply here.
 * They exist to stop a stranger on the public form taking a call that starts in ten minutes;
 * this is a named member of the team moving one call by hand with the prospect on the phone, and
 * "we can't do 6pm because the form says 8 hours' notice" is not a real constraint.
 */
export async function rescheduleBookingToTime(input: RescheduleToTimeInput): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const parsed = customTimeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const booking = await prisma.bookingRequest.findUnique({
    where: { id: d.bookingId },
    select: BOOKING_MOVE_SELECT,
  });
  if (!booking) return { ok: false, error: "Booking not found" };
  const blocked = await otherLiveBookingBlocks(booking);
  if (blocked) return { ok: false, error: blocked };

  // Typed in IST, stored as the UTC instant - the same conversion the slot generator uses, so a
  // hand-made slot and a generated one at the same wall time are the same instant.
  const startsAt = istWallToUtc(d.date, d.time);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "That date and time don't make sense" };
  if (startsAt.getTime() <= Date.now()) return { ok: false, error: "Pick a time in the future" };
  if (startsAt.getTime() - Date.now() > 365 * 86_400_000) {
    return { ok: false, error: "Pick a time within the next year" };
  }
  if (
    booking.slot &&
    booking.slot.startsAt.getTime() === startsAt.getTime() &&
    booking.slot.durationMins === d.durationMins
  ) {
    return { ok: false, error: "That's already this booking's time" };
  }

  // Defaults to whoever owns the call today, so moving a time never silently unassigns it.
  const assignedToId = d.assignedToId?.trim() ? d.assignedToId.trim() : null;
  const endsAt = new Date(startsAt.getTime() + d.durationMins * 60_000);

  /**
   * Don't double-book a person. Prisma cannot express "startsAt + durationMins > :start" in SQL,
   * so the candidates are pulled for a day either side (wider than any slot length the schema
   * allows) and the overlap is decided here. Only for an ASSIGNED call: an unassigned slot
   * belongs to nobody, so it has nobody's diary to clash with.
   */
  if (assignedToId) {
    const near = await prisma.appointmentSlot.findMany({
      where: {
        assignedToId,
        status: "BOOKED",
        id: { not: booking.slotId ?? "" },
        startsAt: { gt: new Date(startsAt.getTime() - 86_400_000), lt: endsAt },
      },
      select: { startsAt: true, durationMins: true },
    });
    const clash = near.find((s) => s.startsAt.getTime() + s.durationMins * 60_000 > startsAt.getTime());
    if (clash) {
      return { ok: false, error: `That clashes with their ${activityStamp(clash.startsAt)} call - pick another time.` };
    }
  }

  let newSlotId = "";
  try {
    await prisma.$transaction(async (tx) => {
      const published = await tx.appointmentSlot.findFirst({
        where: { startsAt, durationMins: d.durationMins, status: "OPEN" },
        select: { id: true },
      });
      if (published) {
        // Only ever ADDS an owner: a published slot already belongs to whoever it was generated
        // for, and "Unassigned" in the picker means "no view on it", not "take their name off".
        const claim = await tx.appointmentSlot.updateMany({
          where: { id: published.id, status: "OPEN" },
          data: { status: "BOOKED", ...(assignedToId ? { assignedToId } : {}) },
        });
        if (claim.count === 0) throw new Error("SLOT_TAKEN");
        newSlotId = published.id;
      } else {
        const made = await tx.appointmentSlot.create({
          data: { startsAt, durationMins: d.durationMins, status: "BOOKED", assignedToId },
          select: { id: true },
        });
        newSlotId = made.id;
      }
      await moveBookingOntoSlot(tx, booking, newSlotId, movedByName(session));
    });
  } catch (e) {
    if (e instanceof Error && e.message === "SLOT_TAKEN") {
      return { ok: false, error: "That time was just taken - pick another one." };
    }
    throw e;
  }

  await afterBookingMoved(session, booking, newSlotId, startsAt);
  return { ok: true };
}

/** Manually mark a booking confirmed (or clear it). The auto-cancel engine reads confirmedAt. */
export async function setBookingConfirmed(id: string, confirmed: boolean): Promise<ActionResult> {
  const session = await requireSection("bookings");
  // `leadId` so the confirmation can move the card as well as stop the auto-cancel engine.
  const booking = await prisma.bookingRequest.findUnique({
    where: { id },
    select: { id: true, name: true, leadId: true },
  });
  if (!booking) return { ok: false, error: "Booking not found" };
  await prisma.bookingRequest.update({
    where: { id },
    data: { confirmedAt: confirmed ? new Date() : null },
  });
  /**
   * The board follows the confirmation.
   *
   * `confirmedAt` used to do one job - stop the auto-cancel engine releasing the slot - and the
   * card stayed in "Discovery Call Booked" whatever the prospect said. But a confirmed booking IS
   * the definition of Pre-Qualified & Confirmed: BANT pre-qualified them, and this is the human
   * saying yes.
   *
   * Only on the way IN. Clearing a confirmation does not rewind the lead: `confirmed: false` is
   * used to correct a mis-click and to re-arm the chase, and dragging the card backwards on a
   * correction would rewrite the stage history for something that never happened.
   */
  if (confirmed && booking.leadId) {
    await markDiscoveryConfirmed(booking.leadId, "manual").catch(() => undefined);
  }
  /**
   * …and so does the SOP. Same reason, one layer down: the outreach engine reads the JOURNEY's
   * confirmation flag, so a call confirmed here kept getting the 36h and 24h reminders and was
   * then written off as a no-show by the post-call sweep. Nothing is rewound on `confirmed:
   * false` - re-arming a chase ladder from a mis-click correction would send real messages, and
   * the safe failure here is the queue asking a human to chase rather than the engine sending.
   */
  if (confirmed) {
    const journeyId = await journeyForBooking(id, booking.leadId);
    if (journeyId) await markSopDiscoConfirmed(journeyId).catch(() => undefined);
  }
  await logActivity(session, {
    action: "booking.confirm",
    section: "bookings",
    entityType: "BookingRequest",
    entityId: id,
    summary: confirmed
      ? `Marked ${booking.name}'s call confirmed`
      : `Cleared the confirmation on ${booking.name}'s call`,
    meta: { confirmed },
  });
  revalidatePath("/bookings");
  return { ok: true };
}

/** Run the confirm-or-cancel + promote engine now (also the /api/cron/whatsapp path). */
export async function runBookingAutomationNow(): Promise<ActionResult & { summary?: string }> {
  await requireSection("bookings");
  const run = await runBookingConfirmations();
  revalidatePath("/bookings");
  if (!run.enabled) return { ok: false, error: run.reason ?? "Confirmation loop is off" };
  return {
    ok: true,
    /**
     * `skippedNotReached` is appended only when it is non-zero, and it is the most important
     * figure in the line when it is: it means the settings WOULD have released those slots and
     * the engine refused, because it cannot prove the prospect was ever asked. Without it a run
     * that did nothing at all reports "0 auto-cancelled" and looks like a quiet day.
     */
    summary:
      `${run.asked} asked · ${run.cancelled} auto-cancelled · ${run.promoted} promoted` +
      (run.skippedNotReached
        ? ` · ${run.skippedNotReached} left alone (never reached them - check WhatsApp is on and the template is approved)`
        : ""),
  };
}
