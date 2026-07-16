import "server-only";

import { prisma } from "@/lib/prisma";
import { getEmailRuntime, sendResendEmail } from "@/lib/email";
import { getSmsRuntime, sendTwilioSms } from "@/lib/sms";

/** Outbound send service for Email + SMS. Writes an append-only Message row every time; actually
 *  hits the provider only when its runtime is enabled (keys set + not paused). Never throws. */

export type SendOutcome = { ok: boolean; status: string; message: string };

export function renderTokens(text: string, lead: { name?: string | null; email?: string | null; phone?: string | null } | null): string {
  if (!lead) return text;
  const first = (lead.name ?? "").trim().split(/\s+/)[0] ?? "";
  return text
    .replaceAll("{{name}}", lead.name ?? "")
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{email}}", lead.email ?? "")
    .replaceAll("{{phone}}", lead.phone ?? "");
}

function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16203A;line-height:1.6">${esc.replace(/\n/g, "<br>")}</div>`;
}

export async function sendEmailMessage(opts: {
  leadId?: string | null;
  to?: string;
  subject: string;
  body: string;
  sentById?: string | null;
}): Promise<SendOutcome> {
  const lead = opts.leadId
    ? await prisma.lead.findUnique({ where: { id: opts.leadId }, select: { name: true, email: true, phone: true } })
    : null;
  const to = (opts.to || lead?.email || "").trim();
  const subject = renderTokens(opts.subject, lead);
  const body = renderTokens(opts.body, lead);

  if (!to) {
    return { ok: false, status: "FAILED", message: "No email address for this contact" };
  }

  const rt = await getEmailRuntime();
  if (!rt.enabled) {
    await prisma.message.create({
      data: {
        channel: "EMAIL", direction: "OUTBOUND", status: "SKIPPED",
        leadId: opts.leadId || null, toAddress: to, subject, body,
        error: rt.configured ? "Email paused" : "Email not configured", sentById: opts.sentById || null,
      },
    });
    return { ok: true, status: "SKIPPED", message: "Logged (email is off — add a Resend key to send for real)" };
  }

  const from = rt.fromName ? `${rt.fromName} <${rt.fromEmail}>` : rt.fromEmail;
  const res = await sendResendEmail({ apiKey: rt.apiKey!, from, to, subject, html: textToHtml(body) });
  await prisma.message.create({
    data: {
      channel: "EMAIL", direction: "OUTBOUND", status: res.ok ? "SENT" : "FAILED",
      leadId: opts.leadId || null, toAddress: to, fromAddress: rt.fromEmail, subject, body,
      provider: "resend", externalId: res.id ?? null, error: res.error ?? null, sentById: opts.sentById || null,
    },
  });
  return res.ok ? { ok: true, status: "SENT", message: "Email sent" } : { ok: false, status: "FAILED", message: res.error ?? "Send failed" };
}

export async function sendSmsMessage(opts: {
  leadId?: string | null;
  to?: string;
  body: string;
  sentById?: string | null;
}): Promise<SendOutcome> {
  const lead = opts.leadId
    ? await prisma.lead.findUnique({ where: { id: opts.leadId }, select: { name: true, email: true, phone: true } })
    : null;
  const to = (opts.to || lead?.phone || "").trim();
  const body = renderTokens(opts.body, lead);

  if (!to) return { ok: false, status: "FAILED", message: "No phone number for this contact" };

  const rt = await getSmsRuntime();
  if (!rt.enabled) {
    await prisma.message.create({
      data: {
        channel: "SMS", direction: "OUTBOUND", status: "SKIPPED",
        leadId: opts.leadId || null, toAddress: to, body,
        error: rt.configured ? "SMS paused" : "SMS not configured", sentById: opts.sentById || null,
      },
    });
    return { ok: true, status: "SKIPPED", message: "Logged (SMS is off — add Twilio keys to send for real)" };
  }

  const res = await sendTwilioSms({ accountSid: rt.accountSid!, authToken: rt.authToken!, from: rt.fromNumber, to, body });
  await prisma.message.create({
    data: {
      channel: "SMS", direction: "OUTBOUND", status: res.ok ? "SENT" : "FAILED",
      leadId: opts.leadId || null, toAddress: to, fromAddress: rt.fromNumber, body,
      provider: "twilio", externalId: res.id ?? null, error: res.error ?? null, sentById: opts.sentById || null,
    },
  });
  return res.ok ? { ok: true, status: "SENT", message: "SMS sent" } : { ok: false, status: "FAILED", message: res.error ?? "Send failed" };
}
