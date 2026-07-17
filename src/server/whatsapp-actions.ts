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
import { logActivity, diffFields } from "./activity-log";

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
    select: { name: true, stage: true, enteredById: true, assignedToId: true },
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
  const isNoShow = lead.stage === "NO_SHOW";
  const out = isNoShow
    ? await sendNoShowFollowupToLead(leadId, session.user.id)
    : await sendDiscoReminderToLead(leadId, session.user.id);
  if (out.sent && out.messageId) {
    await logActivity(session, {
      action: "whatsapp.send",
      section: "pipeline",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent ${lead.name} a ${isNoShow ? "rebook nudge" : "discovery-call reminder"} on WhatsApp`,
      meta: { leadId, kind: isNoShow ? "NO_SHOW_FOLLOWUP" : "DISCO_REMINDER", status: out.status },
    });
  }
  revalidatePath("/pipeline");
  return toResult(out, isNoShow ? "Rebook nudge sent" : "Discovery-call reminder sent");
}

/** Bookings: send/resend the booking confirmation. */
export async function sendBookingConfirmationMsg(bookingId: string): Promise<WhatsAppActionResult> {
  const session = await requireSection("bookings");
  const out = await sendBookingConfirmation(bookingId, session.user.id);
  if (out.sent && out.messageId) {
    const booking = await prisma.bookingRequest.findUnique({ where: { id: bookingId }, select: { name: true } });
    await logActivity(session, {
      action: "whatsapp.send",
      section: "bookings",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent ${booking?.name ?? "a lead"} their booking confirmation on WhatsApp`,
      meta: { bookingRequestId: bookingId, kind: "BOOKING_CONFIRMATION", status: out.status },
    });
  }
  revalidatePath("/bookings");
  return toResult(out, "Booking confirmation sent");
}

/** Bookings: send a pre-call reminder now. */
export async function sendBookingReminderMsg(bookingId: string): Promise<WhatsAppActionResult> {
  const session = await requireSection("bookings");
  const out = await sendBookingReminderFor(bookingId, session.user.id);
  if (out.sent && out.messageId) {
    const booking = await prisma.bookingRequest.findUnique({ where: { id: bookingId }, select: { name: true } });
    await logActivity(session, {
      action: "whatsapp.send",
      section: "bookings",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent ${booking?.name ?? "a lead"} a pre-call reminder on WhatsApp`,
      meta: { bookingRequestId: bookingId, kind: "BOOKING_REMINDER", status: out.status },
    });
  }
  revalidatePath("/bookings");
  return toResult(out, "Pre-call reminder sent");
}

/** Finance: send a payment reminder for an overdue pending payment. */
export async function sendPaymentReminderMsg(pendingPaymentId: string): Promise<WhatsAppActionResult> {
  const session = await requireSection("finance");
  const out = await sendPaymentReminderFor(pendingPaymentId, session.user.id);
  if (out.sent && out.messageId) {
    const payment = await prisma.pendingPayment.findUnique({
      where: { id: pendingPaymentId },
      select: { studentName: true },
    });
    await logActivity(session, {
      action: "whatsapp.send",
      section: "finance",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent ${payment?.studentName ?? "a student"} a payment reminder on WhatsApp`,
      meta: { pendingPaymentId, kind: "PAYMENT_REMINDER", status: out.status },
    });
  }
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
  if (out.sent && out.messageId) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { student: { select: { fullName: true } } },
    });
    await logActivity(session, {
      action: "whatsapp.send",
      section: "students",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent ${enrollment?.student.fullName ?? "a student"} a ${
        kind === "CHECKIN_NUDGE" ? "check-in nudge" : "sprint nudge"
      } on WhatsApp`,
      meta: { enrollmentId, kind, status: out.status },
    });
  }
  revalidatePath("/students");
  return toResult(out, kind === "CHECKIN_NUDGE" ? "Check-in nudge sent" : "Sprint nudge sent");
}

// ───────────────────────── Admin: engine, settings, opt-outs, test ─────────────────────────

/** Run the automatic reminder cadence immediately (also the cron path). */
export async function runRemindersNow(): Promise<WhatsAppActionResult> {
  const session = await requireAdmin();
  const run = await runDueReminders();
  revalidatePath("/whatsapp");
  if (!run.enabled) return { ok: false, message: `Reminders not sent — ${run.reason}` };
  const { sent, skipped, failed } = run.total;
  // The run itself is the admin's; the individual messages stay the engine's (sentById null),
  // so this row records the trigger, never "Asma messaged 40 leads".
  await logActivity(session, {
    action: "whatsapp.reminders.send",
    section: "whatsapp",
    entityType: "AppSetting",
    entityId: "watiConfig",
    summary: `Ran the WhatsApp reminder cadence — ${sent} sent, ${skipped} skipped, ${failed} failed`,
    meta: { sent, skipped, failed },
  });
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
  const session = await requireAdmin();
  const r = await reconcileWhatsAppStatuses();
  revalidatePath("/whatsapp");
  if (r.error) return { ok: false, message: r.error };
  if (r.updated === 0) return { ok: true, message: `Checked ${r.checked} message(s) — all up to date` };
  await logActivity(session, {
    action: "whatsapp.statuses.update",
    section: "whatsapp",
    entityType: "AppSetting",
    entityId: "watiConfig",
    summary: `Synced WhatsApp delivery statuses — updated ${r.updated} of ${r.checked} message(s)`,
    meta: { checked: r.checked, updated: r.updated, failed: r.failed },
  });
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
  if (out.sent && out.messageId) {
    await logActivity(session, {
      action: "whatsapp.send",
      section: "whatsapp",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent a free-form WhatsApp to ${to}`,
      meta: { to, status: out.status, body: text.slice(0, 200) },
    });
  }
  revalidatePath("/whatsapp");
  return toResult(out, "Free-form message sent");
}

/**
 * Pull the tenant's templates from WATI and cache them, so the settings dropdowns show real
 * approved templates with their real variable lists (no typos, no guessed parameters).
 */
export async function refreshWatiTemplates(): Promise<WhatsAppActionResult> {
  const session = await requireAdmin();
  const res = await fetchWatiTemplates();
  if (!res.ok) return { ok: false, message: res.error ?? "Could not fetch templates from WATI" };
  await writeTemplateCatalog(res.templates);
  revalidatePath("/whatsapp");
  const approved = res.templates.filter((t) => t.status === "APPROVED").length;
  await logActivity(session, {
    action: "whatsapp.templates.update",
    section: "whatsapp",
    entityType: "AppSetting",
    entityId: "watiTemplateCatalog",
    summary: `Refreshed the WATI template catalogue — ${res.templates.length} template(s), ${approved} approved`,
    meta: { total: res.templates.length, approved },
  });
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

/**
 * Days-before-due for the EMI reminder. Unlike parseLeadHours, `0` is meaningful here
 * ("on the due day"), and a deliberately cleared box means OFF rather than "use defaults" —
 * so an admin can actually switch this touchpoint off from the settings form.
 */
function parseLeadDays(raw: FormDataEntryValue | null): number[] {
  if (typeof raw !== "string") return DEFAULT_CADENCE.emiPreDueLeadDays;
  if (!raw.trim()) return []; // cleared on purpose → touchpoint disabled
  const list = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 60);
  // Dedupe + sort descending so "3,0" always means "3 days out, then on the day".
  return [...new Set(list)].sort((a, b) => b - a);
}

/** Save the editable (non-secret) WATI settings from the settings form. */
export async function saveWatiSettings(form: FormData): Promise<WhatsAppActionResult> {
  const session = await requireAdmin();
  const before = await readWatiSettings();

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
    emiPreDueLeadDays: parseLeadDays(form.get("emiPreDueLeadDays")),
    // Inverted on purpose. The form asks "send for REAL?" so that an unchecked box — or a
    // form that never renders the field at all — resolves to a dry run. A `dryRun` checkbox
    // would fail the other way: one missing input and every student gets a real message.
    emiPreDueDryRun: !(form.get("emiPreDueLive") === "on" || form.get("emiPreDueLive") === "true"),
    studentRepeatHours: num(form, "studentRepeatHours", DEFAULT_CADENCE.studentRepeatHours),
    maxPerRun: num(form, "maxPerRun", DEFAULT_CADENCE.maxPerRun),
  };

  const defaultCountry = toCountry(String(form.get("defaultCountry") ?? ""));
  const paused = form.get("paused") === "on" || form.get("paused") === "true";

  const settings: WatiSettings = { paused, defaultCountry, templates, cadence };
  await writeWatiSettings(settings);
  const diff = diffFields(before, settings);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "whatsapp.settings.update",
      section: "whatsapp",
      entityType: "AppSetting",
      entityId: "watiConfig",
      summary: `Updated the WhatsApp settings — changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/whatsapp");
  return { ok: true, message: "WhatsApp settings saved" };
}

/** Add or remove a phone number from the WhatsApp opt-out list. */
export async function setWhatsAppOptOut(rawPhone: string, on: boolean): Promise<WhatsAppActionResult> {
  const session = await requireAdmin();
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
  await logActivity(session, {
    action: on ? "whatsapp.optout.create" : "whatsapp.optout.delete",
    section: "whatsapp",
    entityType: "WhatsAppOptOut",
    entityId: phone,
    summary: on
      ? `Opted ${phone} out of WhatsApp messages`
      : `Removed ${phone} from the WhatsApp opt-out list`,
    meta: { phone },
  });
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
  if (out.sent && out.messageId) {
    await logActivity(session, {
      action: "whatsapp.send",
      section: "whatsapp",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent a test "${WHATSAPP_KIND_LABELS[kind]}" WhatsApp to ${to}`,
      meta: { to, kind, test: true, status: out.status },
    });
  }
  revalidatePath("/whatsapp");
  return toResult(out, `Test sent using the "${WHATSAPP_KIND_LABELS[kind]}" template`);
}
