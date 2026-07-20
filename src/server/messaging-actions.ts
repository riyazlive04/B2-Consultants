"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { WhatsAppKind, WhatsAppStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, requireAdmin } from "@/lib/rbac";
import { readEmailSettings, writeEmailSettings } from "@/lib/email";
import { readSmsSettings, writeSmsSettings } from "@/lib/sms";
import { WHATSAPP_KINDS, WHATSAPP_KIND_LABELS } from "@/lib/whatsapp";
import { getWatiRuntime } from "@/lib/wati";
import { optionalRule } from "@/lib/field-rules";
import { sendEmailMessage, sendSmsMessage, type SendOutcome } from "./messaging";
import { sendWhatsApp, sendFreeFormMessage, type SendOutcome as WaSendOutcome } from "./whatsapp";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/** Conversations mutations: send email/SMS/WhatsApp, thread read/assign, template CRUD, channel settings. Gated to `conversations`. */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

// ─────────────────────────── WhatsApp send (Composer) ───────────────────────────
// `sendWhatsApp` returns { messageId, status, sent, skipped, error } (see server/whatsapp.ts);
// the Composer wants the same { ok, status, message } shape the Email/SMS actions return, so this
// adapts it — `ok` only true when the message actually left (mirrors whatsapp-actions.ts's toResult,
// which the rest of the app's "Send WhatsApp" buttons already rely on for honest skip/fail feedback).
export type WhatsAppActionResult = { ok: boolean; message: string; status?: WhatsAppStatus };

function toWaResult(o: WaSendOutcome, successMsg: string): WhatsAppActionResult {
  if (o.sent) return { ok: true, message: successMsg, status: o.status };
  return { ok: false, message: o.error ?? "Message was not sent", status: o.status };
}

/**
 * Free-form (session) WhatsApp reply — only lands inside the 24h window opened by the contact
 * messaging first (see server/whatsapp.ts's sendFreeFormMessage doc comment). This is the mode a
 * human replying inside an open Conversations thread actually wants; business-initiated sends
 * outside that window must use sendWhatsAppTemplateAction below instead.
 */
export async function sendWhatsAppFreeTextAction(leadId: string, form: FormData): Promise<WhatsAppActionResult> {
  const session = await requireSection("conversations");
  const text = String(form.get("body") ?? "").trim();
  if (!text) return { ok: false, message: "Message is required" };
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true, phone: true } });
  if (!lead?.phone) return { ok: false, message: "No phone number for this contact" };
  const out = await sendFreeFormMessage(lead.phone, text, session.user.id);
  if (out.sent && out.messageId) {
    await logActivity(session, {
      action: "whatsapp.send",
      section: "conversations",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent ${lead.name} a free-form WhatsApp reply`,
      meta: { leadId, status: out.status, body: text.slice(0, 200) },
    });
  }
  revalidatePath("/conversations");
  revalidatePath(`/contacts/${leadId}`);
  return toWaResult(out, "WhatsApp message sent");
}

/**
 * Template WhatsApp send — the only way to message a contact outside the 24h session window.
 * `kind` picks one of the touchpoints an Admin has mapped to a real WATI template (WhatsApp →
 * Settings); `param_0..param_n` are that template's OWN variables, in the order it was approved
 * with (never trust the client for the mapping — the param NAMES are re-read from the server-side
 * template config, only the values come from the form).
 */
export async function sendWhatsAppTemplateAction(leadId: string, form: FormData): Promise<WhatsAppActionResult> {
  const session = await requireSection("conversations");
  const raw = String(form.get("kind") ?? "");
  if (!(WHATSAPP_KINDS as readonly string[]).includes(raw)) return { ok: false, message: "Pick a template" };
  const kind = raw as WhatsAppKind;

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true, phone: true } });
  if (!lead?.phone) return { ok: false, message: "No phone number for this contact" };

  const runtime = await getWatiRuntime();
  const template = runtime.settings.templates[kind];
  if (!template) return { ok: false, message: "No WATI template configured for this touchpoint" };

  const vars: Record<string, string> = {};
  template.params.forEach((name, i) => {
    const v = form.get(`param_${i}`);
    if (typeof v === "string" && v.trim()) vars[name] = v.trim();
  });

  const out = await sendWhatsApp({ kind, to: lead.phone, leadId, vars, sentById: session.user.id, runtime });
  if (out.sent && out.messageId) {
    await logActivity(session, {
      action: "whatsapp.send",
      section: "conversations",
      entityType: "WhatsAppMessage",
      entityId: out.messageId,
      summary: `Sent ${lead.name} the "${WHATSAPP_KIND_LABELS[kind]}" WhatsApp template`,
      meta: { leadId, kind, template: template.name, status: out.status, vars },
    });
  }
  revalidatePath("/conversations");
  revalidatePath(`/contacts/${leadId}`);
  return toWaResult(out, "WhatsApp template sent");
}

// ─────────────────────────── Thread read-state + assignment (§0 schema) ───────────────────────────

/** Mark every unread INBOUND Message for this lead read — called when a thread is opened. */
export async function markThreadRead(leadId: string): Promise<ActionResult> {
  await requireSection("conversations");
  await prisma.message.updateMany({ where: { leadId, direction: "INBOUND", read: false }, data: { read: true } });
  revalidatePath("/conversations");
  return { ok: true };
}

/** Assign (or unassign) a whole thread — writes assignedToId onto every Message row for the lead,
 *  so any row (and therefore getInboxThreads' "latest row" read) agrees on who owns it. */
export async function assignThread(leadId: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("conversations");
  const userId = String(form.get("userId") ?? "").trim();
  let assigneeName: string | null = null;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) return { ok: false, error: "User not found" };
    assigneeName = user.name;
  }
  await prisma.message.updateMany({ where: { leadId }, data: { assignedToId: userId || null } });
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true } });
  await logActivity(session, {
    action: "conversation.assign",
    section: "conversations",
    entityType: "Lead",
    entityId: leadId,
    summary: assigneeName
      ? `Assigned ${lead?.name ?? "a contact"}'s conversation to ${assigneeName}`
      : `Unassigned ${lead?.name ?? "a contact"}'s conversation`,
    meta: { assignedToId: userId || null },
  });
  revalidatePath("/conversations");
  return { ok: true };
}

export async function sendEmailAction(leadId: string, form: FormData): Promise<SendOutcome> {
  const session = await requireSection("conversations");
  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!subject) return { ok: false, status: "FAILED", message: "Subject is required" };
  if (!body) return { ok: false, status: "FAILED", message: "Message is required" };
  const res = await sendEmailMessage({ leadId, subject, body, sentById: session.user.id });
  // SENT only: `ok` is also true for a SKIPPED row (channel off), which nobody received.
  if (res.status === "SENT") {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true } });
    await logActivity(session, {
      action: "email.send",
      section: "conversations",
      entityType: "Lead",
      entityId: leadId,
      summary: `Emailed ${lead?.name ?? "a contact"} — "${subject}"`,
      meta: { channel: "EMAIL", subject, body: body.slice(0, 200) },
    });
  }
  revalidatePath("/conversations");
  revalidatePath(`/contacts/${leadId}`);
  return res;
}

export async function sendSmsAction(leadId: string, form: FormData): Promise<SendOutcome> {
  const session = await requireSection("conversations");
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { ok: false, status: "FAILED", message: "Message is required" };
  const res = await sendSmsMessage({ leadId, body, sentById: session.user.id });
  if (res.status === "SENT") {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true } });
    await logActivity(session, {
      action: "sms.send",
      section: "conversations",
      entityType: "Lead",
      entityId: leadId,
      summary: `Sent ${lead?.name ?? "a contact"} an SMS`,
      meta: { channel: "SMS", body: body.slice(0, 200) },
    });
  }
  revalidatePath("/conversations");
  revalidatePath(`/contacts/${leadId}`);
  return res;
}

// ─────────────────────────── Templates ───────────────────────────

// Bounded, but NOT character-filtered: a template name is a label the team invents
// ("Follow-up 2"), and the subject/body are message copy — every character, emoji and
// {{token}} is legitimate. The caps only stop an unbounded string reaching the DB.
const templateSchema = z.object({
  channel: z.enum(["EMAIL", "SMS"]),
  name: z.string().trim().min(1, "Template name is required").max(160, "Template name is too long"),
  subject: z.string().trim().max(300, "Subject is too long").optional(),
  body: z
    .string()
    .trim()
    .min(1, "Template body is required")
    .max(10_000, "Please keep the template under 10,000 characters"),
});

export async function createTemplate(form: FormData): Promise<ActionResult> {
  const session = await requireSection("conversations");
  const parsed = templateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const template = await prisma.messageTemplate.create({
    data: { channel: d.channel, name: d.name, subject: d.channel === "EMAIL" ? d.subject || null : null, body: d.body },
  });
  await logActivity(session, {
    action: "template.create",
    section: "conversations",
    entityType: "MessageTemplate",
    entityId: template.id,
    summary: `Created the ${d.channel} template "${d.name}"`,
    meta: { channel: d.channel },
  });
  revalidatePath("/conversations");
  return { ok: true };
}

export async function updateTemplate(id: string, form: FormData): Promise<ActionResult> {
  const session = await requireSection("conversations");
  const parsed = templateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const before = await prisma.messageTemplate.findUnique({
    where: { id },
    select: { channel: true, name: true, subject: true, body: true },
  });
  const data = {
    channel: d.channel,
    name: d.name,
    subject: d.channel === "EMAIL" ? d.subject || null : null,
    body: d.body,
  };
  await prisma.messageTemplate.update({ where: { id }, data });
  if (before) {
    const diff = diffFields(before, data);
    if (diff.changed.length) {
      await logActivity(session, {
        action: "template.update",
        section: "conversations",
        entityType: "MessageTemplate",
        entityId: id,
        summary: `Updated the ${d.channel} template "${d.name}" — changed ${diff.changed.join(", ")}`,
        meta: { changed: diff.changed, before: diff.before, after: diff.after },
      });
    }
  }
  revalidatePath("/conversations");
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  const session = await requireSection("conversations");
  const template = await prisma.messageTemplate.findUnique({
    where: { id },
    select: { channel: true, name: true },
  });
  await prisma.messageTemplate.delete({ where: { id } });
  if (template) {
    await logActivity(session, {
      action: "template.delete",
      section: "conversations",
      entityType: "MessageTemplate",
      entityId: id,
      summary: `Deleted the ${template.channel} template "${template.name}"`,
    });
  }
  revalidatePath("/conversations");
  return { ok: true };
}

// ─────────────────────────── Channel settings (admin) ───────────────────────────

// Both senders are optional: a channel can be saved half-configured (paused, no address yet),
// so blank stays blank — but a NON-blank value must be a real address/number, or the first
// send fails at the provider with an opaque error instead of here with a fixable one.
// `fromName` is deliberately NOT kind="name": it's a brand, and "B2 Consultants" has a digit.
const emailSettingsSchema = z.object({
  fromName: z.string().trim().max(160, "From name is too long"),
  fromEmail: optionalRule("email"),
});

const smsSettingsSchema = z.object({
  fromNumber: optionalRule("phone"),
});

export async function saveEmailSettings(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const before = await readEmailSettings();
  const parsed = emailSettingsSchema.safeParse({
    fromName: String(form.get("fromName") ?? ""),
    fromEmail: String(form.get("fromEmail") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const settings = {
    paused: String(form.get("paused") ?? "") === "on",
    fromName: parsed.data.fromName || "B2 Consultants",
    fromEmail: parsed.data.fromEmail ?? "",
  };
  await writeEmailSettings(settings);
  const diff = diffFields(before, settings);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "email.settings.update",
      section: "conversations",
      entityType: "AppSetting",
      entityId: "emailConfig",
      summary: `Updated the email channel settings — changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/conversations");
  return { ok: true };
}

export async function saveSmsSettings(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const before = await readSmsSettings();
  const parsed = smsSettingsSchema.safeParse({ fromNumber: String(form.get("fromNumber") ?? "") });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const settings = {
    paused: String(form.get("paused") ?? "") === "on",
    fromNumber: parsed.data.fromNumber ?? "",
  };
  await writeSmsSettings(settings);
  const diff = diffFields(before, settings);
  if (diff.changed.length) {
    await logActivity(session, {
      action: "sms.settings.update",
      section: "conversations",
      entityType: "AppSetting",
      entityId: "smsConfig",
      summary: `Updated the SMS channel settings — changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/conversations");
  return { ok: true };
}
