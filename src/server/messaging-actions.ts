"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { WhatsAppKind, WhatsAppStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, requireAdmin } from "@/lib/rbac";
import { writeEmailSettings } from "@/lib/email";
import { writeSmsSettings } from "@/lib/sms";
import { WHATSAPP_KINDS } from "@/lib/whatsapp";
import { getWatiRuntime } from "@/lib/wati";
import { sendEmailMessage, sendSmsMessage, type SendOutcome } from "./messaging";
import { sendWhatsApp, sendFreeFormMessage, type SendOutcome as WaSendOutcome } from "./whatsapp";
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
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { phone: true } });
  if (!lead?.phone) return { ok: false, message: "No phone number for this contact" };
  const out = await sendFreeFormMessage(lead.phone, text, session.user.id);
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

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { phone: true } });
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
  await requireSection("conversations");
  const userId = String(form.get("userId") ?? "").trim();
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return { ok: false, error: "User not found" };
  }
  await prisma.message.updateMany({ where: { leadId }, data: { assignedToId: userId || null } });
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
  revalidatePath("/conversations");
  revalidatePath(`/contacts/${leadId}`);
  return res;
}

export async function sendSmsAction(leadId: string, form: FormData): Promise<SendOutcome> {
  const session = await requireSection("conversations");
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { ok: false, status: "FAILED", message: "Message is required" };
  const res = await sendSmsMessage({ leadId, body, sentById: session.user.id });
  revalidatePath("/conversations");
  revalidatePath(`/contacts/${leadId}`);
  return res;
}

// ─────────────────────────── Templates ───────────────────────────

const templateSchema = z.object({
  channel: z.enum(["EMAIL", "SMS"]),
  name: z.string().trim().min(1, "Template name is required"),
  subject: z.string().trim().optional(),
  body: z.string().trim().min(1, "Template body is required"),
});

export async function createTemplate(form: FormData): Promise<ActionResult> {
  await requireSection("conversations");
  const parsed = templateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  await prisma.messageTemplate.create({
    data: { channel: d.channel, name: d.name, subject: d.channel === "EMAIL" ? d.subject || null : null, body: d.body },
  });
  revalidatePath("/conversations");
  return { ok: true };
}

export async function updateTemplate(id: string, form: FormData): Promise<ActionResult> {
  await requireSection("conversations");
  const parsed = templateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  await prisma.messageTemplate.update({
    where: { id },
    data: { channel: d.channel, name: d.name, subject: d.channel === "EMAIL" ? d.subject || null : null, body: d.body },
  });
  revalidatePath("/conversations");
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  await requireSection("conversations");
  await prisma.messageTemplate.delete({ where: { id } });
  revalidatePath("/conversations");
  return { ok: true };
}

// ─────────────────────────── Channel settings (admin) ───────────────────────────

export async function saveEmailSettings(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  await writeEmailSettings({
    paused: String(form.get("paused") ?? "") === "on",
    fromName: String(form.get("fromName") ?? "").trim() || "B2 Consultants",
    fromEmail: String(form.get("fromEmail") ?? "").trim(),
  });
  revalidatePath("/conversations");
  return { ok: true };
}

export async function saveSmsSettings(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  await writeSmsSettings({
    paused: String(form.get("paused") ?? "") === "on",
    fromNumber: String(form.get("fromNumber") ?? "").trim(),
  });
  revalidatePath("/conversations");
  return { ok: true };
}
