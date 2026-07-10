"use server";

import { revalidatePath } from "next/cache";
import type { WhatsAppKind, WhatsAppStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireSection } from "@/lib/rbac";
import {
  WHATSAPP_KINDS,
  WHATSAPP_KIND_LABELS,
  DEFAULT_CADENCE,
  type WatiSettings,
  type WatiTemplateMap,
  type WatiCadence,
} from "@/lib/whatsapp";
import { normalizeWhatsappNumber, toCountry } from "@/lib/phone";
import { readWatiSettings, writeWatiSettings, fetchWatiTemplates, writeTemplateCatalog } from "@/lib/wati";
import {
  runDueReminders,
  reconcileWhatsAppStatuses,
  sendFreeFormMessage,
  sendDiscoReminderToLead,
  sendNoShowFollowupToLead,
  sendBookingConfirmation,
  sendBookingReminderFor,
  sendPaymentReminderFor,
  sendStudentNudgeFor,
  sendTestMessage,
  type SendOutcome,
} from "./whatsapp";

/**
 * Server actions for the WhatsApp layer. Every action re-guards (the page guard doesn't protect
 * actions) and returns a WhatsAppActionResult the reusable Send button toasts. `ok` means a real
 * message went out; a skip (WATI off / no template / opted-out) returns ok:false with the reason
 * so the operator gets honest feedback rather than a false "sent".
 */

export type WhatsAppActionResult = { ok: boolean; message: string; status?: WhatsAppStatus };

function toResult(o: SendOutcome, successMsg: string): WhatsAppActionResult {
  if (o.sent) return { ok: true, message: successMsg, status: o.status };
  return { ok: false, message: o.error ?? "Message was not sent", status: o.status };
}

// ───────────────────────── Manual sends from the sections ─────────────────────────

/** Pipeline: nudge a lead. Picks the right template by stage (rebook for no-shows). */
export async function sendLeadReminder(leadId: string): Promise<WhatsAppActionResult> {
  const session = await requireSection("pipeline");
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { stage: true, enteredById: true, assignedToId: true },
  });
  if (!lead) return { ok: false, message: "Lead not found" };
  // Same ownership rule as markLeadContacted: a setter may only message their own/assigned leads.
  if (
    session.role !== "ADMIN" &&
    lead.enteredById !== session.user.id &&
    lead.assignedToId !== session.user.id
  ) {
    return { ok: false, message: "You can only message your own or assigned leads" };
  }
  const out =
    lead.stage === "NO_SHOW"
      ? await sendNoShowFollowupToLead(leadId, session.user.id)
      : await sendDiscoReminderToLead(leadId, session.user.id);
  revalidatePath("/pipeline");
  return toResult(out, lead.stage === "NO_SHOW" ? "Rebook nudge sent" : "Discovery-call reminder sent");
}

/** Bookings: send/resend the booking confirmation. */
export async function sendBookingConfirmationMsg(bookingId: string): Promise<WhatsAppActionResult> {
  const session = await requireSection("bookings");
  const out = await sendBookingConfirmation(bookingId, session.user.id);
  revalidatePath("/bookings");
  return toResult(out, "Booking confirmation sent");
}

/** Bookings: send a pre-call reminder now. */
export async function sendBookingReminderMsg(bookingId: string): Promise<WhatsAppActionResult> {
  const session = await requireSection("bookings");
  const out = await sendBookingReminderFor(bookingId, session.user.id);
  revalidatePath("/bookings");
  return toResult(out, "Pre-call reminder sent");
}

/** Finance: send a payment reminder for an overdue pending payment. */
export async function sendPaymentReminderMsg(pendingPaymentId: string): Promise<WhatsAppActionResult> {
  const session = await requireSection("finance");
  const out = await sendPaymentReminderFor(pendingPaymentId, session.user.id);
  revalidatePath("/finance");
  return toResult(out, "Payment reminder sent");
}

/** Students: check-in / sprint-miss nudge to a student. */
export async function sendStudentNudge(
  enrollmentId: string,
  kind: WhatsAppKind,
): Promise<WhatsAppActionResult> {
  const session = await requireSection("students");
  if (kind !== "CHECKIN_NUDGE" && kind !== "SPRINT_MISS_NUDGE") {
    return { ok: false, message: "Invalid nudge type" };
  }
  const out = await sendStudentNudgeFor(enrollmentId, kind, session.user.id);
  revalidatePath("/students");
  return toResult(out, kind === "CHECKIN_NUDGE" ? "Check-in nudge sent" : "Sprint nudge sent");
}

// ───────────────────────── Admin: engine, settings, opt-outs, test ─────────────────────────

/** Run the automatic reminder cadence immediately (also the cron path). */
export async function runRemindersNow(): Promise<WhatsAppActionResult> {
  await requireAdmin();
  const run = await runDueReminders();
  revalidatePath("/whatsapp");
  if (!run.enabled) return { ok: false, message: `Reminders not sent — ${run.reason}` };
  const { sent, skipped, failed } = run.total;
  return {
    ok: true,
    message: `Reminder run complete — ${sent} sent, ${skipped} skipped, ${failed} failed`,
  };
}

/**
 * Ask WATI what actually happened to recent sends. `Sent` only means WATI accepted the request —
 * Meta can reject it afterwards (deleted template, marketing quality restriction) and reports that
 * via the webhook, which may never reach us. This reconciles the history against WATI's own log.
 */
export async function syncWhatsAppStatuses(): Promise<WhatsAppActionResult> {
  await requireAdmin();
  const r = await reconcileWhatsAppStatuses();
  revalidatePath("/whatsapp");
  if (r.error) return { ok: false, message: r.error };
  if (r.updated === 0) return { ok: true, message: `Checked ${r.checked} message(s) — all up to date` };
  return {
    ok: true,
    message: `Updated ${r.updated} of ${r.checked} message(s)${r.failed ? ` — ${r.failed} actually FAILED at Meta` : ""}`,
  };
}

/** Free-form message. Only lands inside the 24h window the contact opened by messaging us. */
export async function sendFreeFormWhatsApp(form: FormData): Promise<WhatsAppActionResult> {
  const session = await requireAdmin();
  const to = String(form.get("to") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();
  if (!to) return { ok: false, message: "Enter a number" };
  if (!text) return { ok: false, message: "Enter a message" };
  const out = await sendFreeFormMessage(to, text, session.user.id);
  revalidatePath("/whatsapp");
  return toResult(out, "Free-form message sent");
}

/**
 * Pull the tenant's templates from WATI and cache them, so the settings dropdowns show real
 * approved templates with their real variable lists (no typos, no guessed parameters).
 */
export async function refreshWatiTemplates(): Promise<WhatsAppActionResult> {
  await requireAdmin();
  const res = await fetchWatiTemplates();
  if (!res.ok) return { ok: false, message: res.error ?? "Could not fetch templates from WATI" };
  await writeTemplateCatalog(res.templates);
  revalidatePath("/whatsapp");
  const approved = res.templates.filter((t) => t.status === "APPROVED").length;
  return {
    ok: true,
    message: `Loaded ${res.templates.length} template(s) from WATI — ${approved} approved`,
  };
}

function num(form: FormData, key: string, fallback: number): number {
  const v = form.get(key);
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseLeadHours(raw: FormDataEntryValue | null): number[] {
  if (typeof raw !== "string") return DEFAULT_CADENCE.bookingReminderLeadHours;
  const list = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return list.length ? list : DEFAULT_CADENCE.bookingReminderLeadHours;
}

/** Save the editable (non-secret) WATI settings from the settings form. */
export async function saveWatiSettings(form: FormData): Promise<WhatsAppActionResult> {
  await requireAdmin();

  const templates: WatiTemplateMap = {};
  for (const kind of WHATSAPP_KINDS) {
    const name = String(form.get(`tpl_${kind}_name`) ?? "").trim().slice(0, 200);
    const broadcast = String(form.get(`tpl_${kind}_broadcast`) ?? "").trim().slice(0, 200);
    // The template's OWN variables, in approval order. Blank is valid — many approved
    // templates take none. Never defaulted: guessing here means a rejected send.
    const params = String(form.get(`tpl_${kind}_params`) ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (name) templates[kind] = { name, ...(broadcast ? { broadcastName: broadcast } : {}), params };
  }

  const cadence: WatiCadence = {
    discoFirstDelayHours: num(form, "discoFirstDelayHours", DEFAULT_CADENCE.discoFirstDelayHours),
    discoRepeatHours: num(form, "discoRepeatHours", DEFAULT_CADENCE.discoRepeatHours),
    discoMaxReminders: num(form, "discoMaxReminders", DEFAULT_CADENCE.discoMaxReminders),
    bookingReminderLeadHours: parseLeadHours(form.get("bookingReminderLeadHours")),
    noShowDelayHours: num(form, "noShowDelayHours", DEFAULT_CADENCE.noShowDelayHours),
    paymentRepeatHours: num(form, "paymentRepeatHours", DEFAULT_CADENCE.paymentRepeatHours),
    studentRepeatHours: num(form, "studentRepeatHours", DEFAULT_CADENCE.studentRepeatHours),
    maxPerRun: num(form, "maxPerRun", DEFAULT_CADENCE.maxPerRun),
  };

  const defaultCountry = toCountry(String(form.get("defaultCountry") ?? ""));
  const paused = form.get("paused") === "on" || form.get("paused") === "true";

  const settings: WatiSettings = { paused, defaultCountry, templates, cadence };
  await writeWatiSettings(settings);
  revalidatePath("/whatsapp");
  return { ok: true, message: "WhatsApp settings saved" };
}

/** Add or remove a phone number from the WhatsApp opt-out list. */
export async function setWhatsAppOptOut(rawPhone: string, on: boolean): Promise<WhatsAppActionResult> {
  await requireAdmin();
  const settings = await readWatiSettings();
  const phone = normalizeWhatsappNumber(rawPhone, settings.defaultCountry);
  if (!phone) return { ok: false, message: "Enter a valid phone number with its country code (e.g. +49…)" };
  if (on) {
    await prisma.whatsAppOptOut.upsert({
      where: { phone },
      create: { phone, reason: "Manually opted out (Admin)" },
      update: {},
    });
  } else {
    await prisma.whatsAppOptOut.deleteMany({ where: { phone } });
  }
  revalidatePath("/whatsapp");
  return { ok: true, message: on ? "Number opted out" : "Opt-out removed" };
}

/**
 * Send a test to any number using the template mapped to the chosen touchpoint — so you verify the
 * real template (and its media header), not a stand-in.
 */
export async function sendTestWhatsApp(form: FormData): Promise<WhatsAppActionResult> {
  const session = await requireAdmin();
  const to = String(form.get("to") ?? "").trim();
  if (!to) return { ok: false, message: "Enter a number to test" };

  const raw = String(form.get("kind") ?? "MANUAL");
  if (!(WHATSAPP_KINDS as readonly string[]).includes(raw)) {
    return { ok: false, message: "Pick a valid touchpoint to test" };
  }
  const kind = raw as WhatsAppKind;

  const out = await sendTestMessage(to, kind, session.user.id);
  revalidatePath("/whatsapp");
  return toResult(out, `Test sent using the "${WHATSAPP_KIND_LABELS[kind]}" template`);
}
