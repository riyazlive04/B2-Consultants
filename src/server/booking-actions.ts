"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { istWallToUtc } from "@/lib/dates";
import { computeBant, INTAKE_OPTIONS } from "@/lib/booking-intake";
import { upsertIntakeLead } from "./lead-intake";
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
  slotId: z.string().min(1, "Please choose an available time"),
  name: z.string().trim().min(1, "Your name is required"),
  email: z.string().trim().email("A valid email is required"),
  phone: z.string().trim().min(5, "Phone / WhatsApp with country code is required"),
  whatsapp: z.string().trim().optional(),
  city: z.string().trim().optional(),
  currentJobTitle: z.string().trim().optional(),
  prospectIndustry: z.string().trim().optional(),
  linkedInProfile: z.string().trim().optional(),
  highestEducation: optional("highestEducation"),
  yearsExperience: optional("yearsExperience"),
  whyGermany: z.string().trim().optional(),
  participateWorkshop: optional("participateWorkshop"),
  reasonForCall: z.string().trim().optional(),
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
  // spam honeypot - real users never fill this hidden field
  company_website: z.string().optional(),
  utm: z.string().optional(), // JSON blob captured client-side from the URL
});

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Please check the form and try again";
}

function clean(v: string | undefined): string | null {
  return v && v.trim() ? v.trim() : null;
}

export async function submitBooking(form: FormData): Promise<ActionResult> {
  const parsed = bookingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  if (d.company_website) return { ok: true }; // honeypot tripped - silently drop

  // Slot must exist, be OPEN, and be in the future.
  const slot = await prisma.appointmentSlot.findUnique({ where: { id: d.slotId } });
  if (!slot || slot.status !== "OPEN" || slot.startsAt.getTime() <= Date.now()) {
    return { ok: false, error: "That time was just taken - please pick another slot." };
  }

  const bant = computeBant(d);
  let utm: Record<string, string> | null = null;
  if (d.utm) {
    try {
      const obj = JSON.parse(d.utm);
      if (obj && typeof obj === "object") utm = obj as Record<string, string>;
    } catch {
      /* ignore malformed utm */
    }
  }

  // Lead first (its own transaction inside the helper). BOOKING_FORM provenance;
  // channel from "how did you hear about us", default LANDING_PAGE.
  const { lead } = await upsertIntakeLead({
    name: d.name,
    phone: d.phone,
    email: d.email,
    city: clean(d.city),
    leadSource: (d.howKnowUs && HOW_TO_CHANNEL[d.howKnowUs]) || LeadSource.LANDING_PAGE,
    source: "BOOKING_FORM",
    utm,
    notes: clean(d.reasonForCall),
  });

  // Claim the slot + create the booking + advance the lead to DISCO_BOOKED atomically.
  // updateMany with a status guard is the concurrency lock against a double-book.
  try {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.appointmentSlot.updateMany({
        where: { id: slot.id, status: "OPEN" },
        data: { status: "BOOKED" },
      });
      if (claim.count === 0) throw new Error("SLOT_TAKEN");

      await tx.bookingRequest.create({
        data: {
          slotId: slot.id,
          leadId: lead.id,
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
        },
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
    });
  } catch (e) {
    if (e instanceof Error && e.message === "SLOT_TAKEN") {
      return { ok: false, error: "That time was just taken - please pick another slot." };
    }
    throw e;
  }

  revalidatePath("/bookings");
  revalidatePath("/book");
  return { ok: true };
}

// ─────────────────────────── Admin: slot + booking management ───────────────────────────

const slotGenSchema = z.object({
  date: z.string().min(10, "Pick a date"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Start time HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "End time HH:MM"),
  intervalMins: z.coerce.number().int().min(15).max(240),
  durationMins: z.coerce.number().int().min(15).max(240),
});

/** Admin generates OPEN slots across an IST time window (e.g. 15:00-18:00 every 30m). */
export async function generateSlots(form: FormData): Promise<ActionResult> {
  await requireSection("bookings");
  const parsed = slotGenSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const startUtc = istWallToUtc(d.date, d.startTime).getTime();
  const endUtc = istWallToUtc(d.date, d.endTime).getTime();
  if (endUtc <= startUtc) return { ok: false, error: "End time must be after start time" };

  const stepMs = d.intervalMins * 60_000;
  const starts: Date[] = [];
  for (let t = startUtc; t + d.durationMins * 60_000 <= endUtc + 1; t += stepMs) {
    starts.push(new Date(t));
  }
  if (!starts.length) return { ok: false, error: "That window fits no slots - widen it or shorten the duration" };

  // Skip any instant that already has a slot, so re-running the day is idempotent.
  const existing = await prisma.appointmentSlot.findMany({
    where: { startsAt: { in: starts } },
    select: { startsAt: true },
  });
  const taken = new Set(existing.map((s) => s.startsAt.getTime()));
  const fresh = starts.filter((s) => !taken.has(s.getTime()));
  if (fresh.length) {
    await prisma.appointmentSlot.createMany({
      data: fresh.map((startsAt) => ({ startsAt, durationMins: d.durationMins })),
    });
  }

  revalidatePath("/bookings");
  return { ok: true };
}

/** Delete an OPEN or BLOCKED slot (a BOOKED slot must be cancelled via the booking first). */
export async function deleteSlot(id: string): Promise<ActionResult> {
  await requireSection("bookings");
  const slot = await prisma.appointmentSlot.findUnique({ where: { id }, select: { status: true } });
  if (!slot) return { ok: false, error: "Slot not found" };
  if (slot.status === "BOOKED") return { ok: false, error: "Cancel the booking before removing this slot" };
  await prisma.appointmentSlot.delete({ where: { id } });
  revalidatePath("/bookings");
  return { ok: true };
}

const BOOKING_STATUSES = ["BOOKED", "RESCHEDULED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const;

/**
 * Admin sets a booking's outcome. CANCELLED / NO_SHOW free the slot back to OPEN and,
 * for a no-show, move the lead to NO_SHOW so the pipeline's deal-risk view surfaces it.
 */
export async function setBookingStatus(id: string, status: string): Promise<ActionResult> {
  await requireSection("bookings");
  if (!(BOOKING_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Invalid status" };
  }
  const booking = await prisma.bookingRequest.findUnique({
    where: { id },
    select: { slotId: true, leadId: true },
  });
  if (!booking) return { ok: false, error: "Booking not found" };

  await prisma.$transaction(async (tx) => {
    await tx.bookingRequest.update({ where: { id }, data: { status: status as (typeof BOOKING_STATUSES)[number] } });

    if ((status === "CANCELLED" || status === "NO_SHOW") && booking.slotId) {
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

  revalidatePath("/bookings");
  revalidatePath("/pipeline");
  return { ok: true };
}
