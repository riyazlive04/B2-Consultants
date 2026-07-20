"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { istWallToUtc, parseDateInput, toDateInputValue } from "@/lib/dates";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";
import { computeBant, INTAKE_OPTIONS } from "@/lib/booking-intake";
import { qualifiedFromBant } from "@/lib/outreach-sop";
import { CONSENT_LABEL, CONSENT_POLICY_VERSION, CONSENT_VALUE } from "@/lib/consent";
import { bookingRulesConfigSchema } from "@/lib/config-schema";
import { optionalRule, rule } from "@/lib/field-rules";
import { activityStamp } from "@/lib/activity-actions";
import { BOOKING_RULES_KEY, getBookingRulesConfig, writeBookingRulesConfig } from "./founder-config";
import { logActivity, diffFields } from "./activity-log";
import { emitTrigger } from "./automation";
import { upsertIntakeLead } from "./lead-intake";
import { sendBookingConfirmation, sendBookingRescheduled } from "./whatsapp";
import { promoteIntoFreedSlot, runBookingConfirmations } from "./booking-automation";
import { sendEmailMessage } from "./messaging";
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
  summit: "SUMMIT",
  ghosted_blueprint: "GHOSTED_BLUEPRINT",
  other: "OTHER",
};

const bookingSchema = z.object({
  slotId: z.string().min(1, "Please choose an available time").max(64),
  // Character rules come from lib/field-rules so the browser filter and this parse can't drift.
  // These are the PUBLIC form's fields — the filter is unreachable for a crafted POST, so the
  // schema is the only real gate here.
  name: rule("name"),
  // The email rule folds to lowercase (not just trims): this address is the key the SOP's Step 10
  // cross-check matches a lead to their booking on, and "Ameen@X.com" vs "ameen@x.com" would
  // report a booked prospect as "not booked".
  email: rule("email"),
  phone: rule("phone"),
  whatsapp: optionalRule("phone"),
  city: optionalRule("city"),
  currentJobTitle: z.string().trim().max(160).optional(),
  prospectIndustry: z.string().trim().max(160).optional(),
  linkedInProfile: optionalRule("url"),
  highestEducation: optional("highestEducation"),
  yearsExperience: optional("yearsExperience"),
  whyGermany: z.string().trim().max(2000, "Please keep this under 2000 characters").optional(),
  participateWorkshop: optional("participateWorkshop"),
  reasonForCall: z.string().trim().max(2000, "Please keep this under 2000 characters").optional(),
  alreadyApplied: optional("alreadyApplied"),
  whenStartGermany: optional("whenStartGermany"),
  germanVisa: optional("germanVisa"),
  germanLevel: optional("germanLevel"),
  willingnessLearnGerman: optional("willingnessLearnGerman"),
  currentIncome: optional("currentIncome"),
  readyToInvest: optional("readyToInvest"),
  decisionMaking: optional("decisionMaking"),
  commitment: optional("commitment"),
  howKnowUs: optional("howKnowUs"),
  // GDPR consent (spec §15). Optional in the SCHEMA but mandatory in the ACTION: an unticked
  // checkbox posts nothing at all, and a bare z.literal would fail with "Invalid literal
  // value" — useless to a prospect. Parsed loosely, then refused explicitly below.
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

export async function submitBooking(form: FormData): Promise<ActionResult> {
  // Public endpoint: throttle per IP so one client can't exhaust the open slots
  // or flood the pipeline with junk leads. 5 attempts / 10 min is generous for a
  // human correcting form errors.
  const hdrs = await Promise.resolve(headers());
  const ip = clientIpFrom(hdrs);
  if (!rateLimitOk(`book:${ip}`, 5, 10 * 60_000)) {
    return { ok: false, error: "Too many booking attempts - please try again in a few minutes." };
  }
  const userAgent = hdrs.get("user-agent");

  const parsed = bookingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  if (d.company_website) return { ok: true }; // honeypot tripped - silently drop

  // ── Consent gate (spec §15, §19.1-C1) ────────────────────────────────────────
  // "No lead/student data is stored without explicit consent" — GDPR, and our prospects are
  // in Germany and India. This sits ABOVE every write below: both the auto-disqualify branch
  // and the booked branch call upsertIntakeLead, so refusing here is what makes "no consent,
  // no row" true of the whole action rather than of one path.
  //
  // Fails CLOSED. A tampered POST, or a stale page cached from before this field existed,
  // posts no consent and is refused — the safe direction for a rule about not storing people.
  if (d.consent !== CONSENT_VALUE) {
    return { ok: false, error: "Please tick the consent box so we can store your details and contact you." };
  }

  const rules = await getBookingRulesConfig();
  const bant = computeBant(d);
  const utm = d.utm ? sanitizeUtm(d.utm) : null;

  // The evidence half of the gate above. Written inside whichever transaction ends up
  // persisting this prospect, so a booking can never commit without its consent row: the
  // proof and the data it authorises land together or not at all.
  //
  // `region` stays null deliberately. Spec §15 asks for it, but the form has no country
  // field and `city` is free text — deriving "DE" from a typed city name would be a guess
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
  };

  // ── Auto-disqualify ──────────────────────────────────────────────────────────
  // A BANT "CANCEL" verdict (weighted avg < 2) means the prospect does not qualify. Per the
  // sales rule, don't hold a call: record the intake as a CANCELLED booking WITHOUT claiming a
  // slot (it stays OPEN for a qualified prospect), move the lead to LOST with an audited reason,
  // and send the polite rejection template. Founder-gated (default on). The email is still
  // behind the Resend seam, so with email off it's logged SKIPPED — never sent unconfigured.
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
        const reason = `Auto-disqualified at intake — BANT ${bant.bantAvg.toFixed(1)}/5`;
        await tx.lead.update({
          where: { id: lead.id },
          data: { stage: "LOST", notes: fresh.notes ? `${fresh.notes} · ${reason}` : reason },
        });
        await tx.leadStageHistory.create({
          data: { leadId: lead.id, fromStage: fresh.stage, toStage: "LOST" },
        });
      }

      // Close the SOP journey too (Step 17 — NO → terminal). A BANT CANCEL is a "Not Qualified"
      // verdict, so record it and move the journey to IGNORED; otherwise a disqualified prospect
      // would sit in the active outreach queue being chased forever. The CANCELLED booking is
      // deliberately NOT linked (bookingId stays null): the engine's cross-check excludes CANCELLED
      // bookings, and Key Metrics is a booked-prospects surface — a LOST lead doesn't belong there.
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

    // Founder-editable rejection template; renders {{name}} tokens and logs a Message row.
    // Never let an email failure surface into the prospect's submit result.
    try {
      await sendEmailMessage({ leadId: lead.id, subject: rules.rejectionSubject, body: rules.rejectionBody });
    } catch {
      /* email is best-effort */
    }

    revalidatePath("/bookings");
    revalidatePath("/book");
    return { ok: true };
  }

  // ── Qualified / doubt / confirm — book the slot ───────────────────────────────
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

      // A booked call = DISCO_BOOKED; mirror BANT onto a DiscoveryOutcome-free path by
      // only advancing the stage (the closer records the outcome after the call).
      const fresh = await tx.lead.findUnique({ where: { id: lead.id }, select: { stage: true } });
      if (fresh && fresh.stage === "NEW_LEAD") {
        await tx.lead.update({ where: { id: lead.id }, data: { stage: "DISCO_BOOKED" } });
        await tx.leadStageHistory.create({
          data: { leadId: lead.id, fromStage: "NEW_LEAD", toStage: "DISCO_BOOKED" },
        });
      }

      // SOP Steps 10–11, synchronously. A prospect who books directly on the public form would
      // otherwise stay unlinked from their booking — the ONLY thing that links the two is the
      // async engine's Step 10 cross-check, and that engine is off by default. So without this,
      // a booked prospect's BANT score never reaches the Qualified verdict (Step 11) or Key
      // Metrics (Step 12): the outreach tab shows them as "not booked" while /bookings shows them
      // booked. Link the journey here and derive Qualified from BANT — the same pure function the
      // engine uses, so the two paths can never disagree. Guarded so it can't clobber a link or a
      // human's prior verdict; a lead created outside intake (manual back-office entry) may have no
      // journey, which is fine — updateMany-style tolerance via the null check.
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
    throw e;
  }

  // Tell the automation engine a booking happened, the same way moveOpportunity fires
  // STAGE_CHANGED after its own transaction commits. Previously nothing called this for a
  // booking, so BOOKING_CREATED workflows could never enroll a single contact.
  await emitTrigger("BOOKING_CREATED", { leadId: lead.id });

  // Wave-2: fire the WhatsApp booking confirmation. No-op (and writes no row) unless WATI is
  // configured + enabled; it never throws, so it can't affect the booking result.
  await sendBookingConfirmation(bookingId);

  revalidatePath("/bookings");
  revalidatePath("/book");
  return { ok: true };
}

// ─────────────────────────── Admin: slot + booking management ───────────────────────────

const WEEKDAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
type WeekdayKey = (typeof WEEKDAY_KEYS)[number];
// Date#getUTCDay() on a UTC-midnight calendar date (parseDateInput's encoding) gives the
// correct civil weekday regardless of IST offset - see dates.ts's istToday for the same trick.
const WEEKDAY_FROM_JSDAY: Record<number, WeekdayKey> = {
  0: "SUN", 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT",
};

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
  // Buffer sits on top of the admin's chosen interval, so consecutive slots keep a real gap
  // instead of sitting back-to-back with zero gap whenever interval === duration.
  const stepMs = (d.intervalMins + rules.bufferMinutes) * 60_000;

  const starts: Date[] = [];
  for (let i = 0; i <= daySpan; i++) {
    const day = new Date(startDateObj);
    day.setUTCDate(startDateObj.getUTCDate() + i);
    if (!d.weekdays.includes(WEEKDAY_FROM_JSDAY[day.getUTCDay()])) continue;

    const dateStr = toDateInputValue(day);
    const dayStartUtc = istWallToUtc(dateStr, d.startTime).getTime();
    const dayEndUtc = istWallToUtc(dateStr, d.endTime).getTime();
    for (let t = dayStartUtc; t + d.durationMins * 60_000 <= dayEndUtc + 1; t += stepMs) {
      starts.push(new Date(t));
    }
  }
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
    // entity here — "batch" can never collide with a real slot's cuid.
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
  // Confirmation loop (Module E) — the two window fields; the toggles are read separately below
  // because an unchecked HTML checkbox submits nothing at all.
  confirmRequestLeadHours: z.coerce.number().int().min(0).max(240),
  autoCancelHours: z.coerce.number().int().min(0).max(240),
});

/** Admin edits the slot window + the confirmation-loop cadence/toggles (AppSetting). */
export async function updateBookingRules(form: FormData): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const parsed = bookingRulesFormSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  // Merge over the current config so saving never resets the auto-disqualify toggle or the
  // rejection template (which this form doesn't carry).
  const current = await getBookingRulesConfig();
  const next = {
    ...current,
    ...parsed.data,
    autoCancelEnabled: form.get("autoCancelEnabled") === "on",
    promoteNext: form.get("promoteNext") === "on",
  };
  // Validate the full merged config — including the "ask lead > cancel window" refinement — before
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
      summary: `Updated the booking rules — changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/bookings");
  revalidatePath("/book");
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
 * booking from it (nulling the unique slotId) so the slot is cleanly re-bookable — leaving the old
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
    select: { slotId: true, leadId: true, name: true, status: true },
  });
  if (!booking) return { ok: false, error: "Booking not found" };

  const freesSlot = (status === "CANCELLED" || status === "NO_SHOW") && !!booking.slotId;

  await prisma.$transaction(async (tx) => {
    await tx.bookingRequest.update({
      where: { id },
      data: {
        status: status as (typeof BOOKING_STATUSES)[number],
        ...(freesSlot ? { slotId: null } : {}),
      },
    });

    if (freesSlot && booking.slotId) {
      await tx.appointmentSlot.update({ where: { id: booking.slotId }, data: { status: "OPEN" } });
    }
    if (status === "NO_SHOW" && booking.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: booking.leadId }, select: { stage: true } });
      if (lead && lead.stage !== "NO_SHOW") {
        await tx.lead.update({ where: { id: booking.leadId }, data: { stage: "NO_SHOW" } });
        await tx.leadStageHistory.create({
          data: { leadId: booking.leadId, fromStage: lead.stage, toStage: "NO_SHOW" },
        });
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
  if (slot.status === next) return { ok: true }; // already there — no-op
  // Guard the transition so we never blindly flip a slot that changed under us.
  const res = await prisma.appointmentSlot.updateMany({
    where: { id, status: blocked ? "OPEN" : "BLOCKED" },
    data: { status: next },
  });
  if (res.count === 0) return { ok: false, error: "Slot changed — refresh and try again" };
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
 * Postpone a booking onto another slot: free the old slot, claim the new OPEN one, and reset the
 * confirmation so the prospect re-confirms the NEW time (a fresh confirm-request goes out as that
 * slot approaches). The prospect is told the call moved. Concurrency-guarded against a double-book.
 */
export async function rescheduleBooking(bookingId: string, newSlotId: string): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const booking = await prisma.bookingRequest.findUnique({
    where: { id: bookingId },
    select: { slotId: true, status: true, name: true },
  });
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.status === "CANCELLED") return { ok: false, error: "This booking is cancelled — it can't be moved" };
  if (booking.slotId === newSlotId) return { ok: false, error: "That's already this booking's slot" };

  const target = await prisma.appointmentSlot.findUnique({ where: { id: newSlotId }, select: { status: true, startsAt: true } });
  if (!target) return { ok: false, error: "That slot no longer exists" };
  if (target.status !== "OPEN") return { ok: false, error: "That slot isn't open — pick another time" };
  if (target.startsAt.getTime() <= Date.now()) return { ok: false, error: "Pick a slot in the future" };

  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.appointmentSlot.updateMany({
        where: { id: newSlotId, status: "OPEN" },
        data: { status: "BOOKED" },
      });
      if (claim.count === 0) throw new Error("SLOT_TAKEN");
      // Point the booking at the new slot first (moves the unique slotId off the old one)…
      await tx.bookingRequest.update({
        where: { id: bookingId },
        data: { slotId: newSlotId, status: "BOOKED", confirmedAt: null, confirmSentAt: null },
      });
      // …then release the old slot back to OPEN.
      if (booking.slotId) {
        await tx.appointmentSlot.update({ where: { id: booking.slotId }, data: { status: "OPEN" } });
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === "SLOT_TAKEN") {
      return { ok: false, error: "That time was just taken — pick another slot." };
    }
    throw e;
  }

  await logActivity(session, {
    action: "booking.reschedule",
    section: "bookings",
    entityType: "BookingRequest",
    entityId: bookingId,
    summary: `Moved ${booking.name}'s call to ${activityStamp(target.startsAt)}`,
    meta: { changed: ["slotId"], before: { slotId: booking.slotId }, after: { slotId: newSlotId } },
  });

  // Intimate the prospect their call moved (best-effort; silent when WhatsApp is off).
  await sendBookingRescheduled(bookingId, session.user.id);
  revalidatePath("/bookings");
  return { ok: true };
}

/** Manually mark a booking confirmed (or clear it). The auto-cancel engine reads confirmedAt. */
export async function setBookingConfirmed(id: string, confirmed: boolean): Promise<ActionResult> {
  const session = await requireSection("bookings");
  const booking = await prisma.bookingRequest.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!booking) return { ok: false, error: "Booking not found" };
  await prisma.bookingRequest.update({
    where: { id },
    data: { confirmedAt: confirmed ? new Date() : null },
  });
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
    summary: `${run.asked} asked · ${run.cancelled} auto-cancelled · ${run.promoted} promoted`,
  };
}
