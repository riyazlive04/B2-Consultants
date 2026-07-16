import "server-only";

import { prisma } from "@/lib/prisma";
import { getEmailRuntime } from "@/lib/email";
import { getSmsRuntime } from "@/lib/sms";
import { getWatiRuntime } from "@/lib/wati";
import { WHATSAPP_KIND_LABELS } from "@/lib/whatsapp";
import type { WhatsAppKind } from "@prisma/client";

/** Read layer for the unified Conversations inbox (Message + WhatsAppMessage), templates, settings. */

export type InboxThread = {
  leadId: string;
  name: string;
  /** Null since the Synamate import — a contact can exist with no number. Display only; the send
   *  actions re-read the phone and refuse on their own (messaging-actions.ts). */
  phone: string | null;
  email: string | null;
  lastAt: Date;
  lastSnippet: string;
  lastChannel: "EMAIL" | "SMS" | "WHATSAPP";
  /** True when the most recent INBOUND `Message` (Email/SMS) row for this lead is unread.
   *  WhatsApp threads don't carry this signal — `read`/`assignedToId` (§0 schema) only live on
   *  `Message`, so a thread whose latest activity is a WhatsApp reply won't flip this true even
   *  though WATI's own REPLIED status already surfaces that elsewhere. */
  unread: boolean;
  assignedToId: string | null;
  assignedToName: string | null;
};

export async function getInboxThreads(): Promise<InboxThread[]> {
  const [messages, wa] = await Promise.all([
    prisma.message.findMany({
      where: { leadId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 400,
      include: {
        lead: { select: { id: true, name: true, phone: true, email: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.whatsAppMessage.findMany({
      where: { leadId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 400,
      include: { lead: { select: { id: true, name: true, phone: true, email: true } } },
    }),
  ]);

  const threads = new Map<string, InboxThread>();
  const consider = (leadId: string | null, lead: { id: string; name: string; phone: string | null; email: string | null } | null, at: Date, snippet: string, channel: InboxThread["lastChannel"]) => {
    if (!leadId || !lead) return;
    const existing = threads.get(leadId);
    if (!existing || at > existing.lastAt) {
      threads.set(leadId, { leadId, name: lead.name, phone: lead.phone, email: lead.email, lastAt: at, lastSnippet: snippet.slice(0, 90), lastChannel: channel, unread: false, assignedToId: null, assignedToName: null });
    }
  };
  for (const m of messages) consider(m.leadId, m.lead, m.createdAt, m.subject ? `${m.subject}: ${m.body}` : m.body, m.channel as InboxThread["lastChannel"]);
  for (const m of wa) consider(m.leadId, m.lead, m.createdAt, m.body ?? "(template)", "WHATSAPP");

  // Thread-level read/assignment state, sourced from `Message` only (the schema field only lives
  // there — see §0). "Unread" = the most recent INBOUND Message row is unread. "Assigned to" =
  // whoever the most recent Message row (either direction) is assigned to — assignThread() below
  // writes assignedToId onto every Message row for the lead in one pass, so any row agrees.
  const latestInboundAt = new Map<string, Date>();
  const latestAssignAt = new Map<string, Date>();
  for (const m of messages) {
    if (!m.leadId) continue;
    const t = threads.get(m.leadId);
    if (!t) continue;
    if (m.direction === "INBOUND") {
      const at = latestInboundAt.get(m.leadId);
      if (!at || m.createdAt > at) {
        latestInboundAt.set(m.leadId, m.createdAt);
        t.unread = !m.read;
      }
    }
    const aAt = latestAssignAt.get(m.leadId);
    if (!aAt || m.createdAt > aAt) {
      latestAssignAt.set(m.leadId, m.createdAt);
      t.assignedToId = m.assignedToId;
      t.assignedToName = m.assignedTo?.name ?? null;
    }
  }

  return [...threads.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()).slice(0, 60);
}

/** Active users, for the Conversations "Assign to" control. */
export async function getAssignableUsers(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export type ThreadMessage = {
  id: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP";
  direction: "OUTBOUND" | "INBOUND";
  subject: string | null;
  body: string;
  status: string;
  at: Date;
};

export type ThreadView = {
  lead: { id: string; name: string; phone: string | null; email: string | null };
  messages: ThreadMessage[];
};

export async function getThread(leadId: string): Promise<ThreadView | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, phone: true, email: true } });
  if (!lead) return null;
  const [messages, wa] = await Promise.all([
    prisma.message.findMany({ where: { leadId }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.whatsAppMessage.findMany({ where: { leadId }, orderBy: { createdAt: "asc" }, take: 200 }),
  ]);
  const items: ThreadMessage[] = [];
  for (const m of messages) {
    items.push({ id: `m-${m.id}`, channel: m.channel as "EMAIL" | "SMS", direction: m.direction as "OUTBOUND" | "INBOUND", subject: m.subject, body: m.body, status: m.status, at: m.createdAt });
  }
  for (const m of wa) {
    items.push({ id: `w-${m.id}`, channel: "WHATSAPP", direction: m.direction as "OUTBOUND" | "INBOUND", subject: null, body: m.body ?? `(${m.kind ?? "template"})`, status: m.status, at: m.createdAt });
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { lead, messages: items };
}

export async function getTemplates() {
  const rows = await prisma.messageTemplate.findMany({ orderBy: { name: "asc" } });
  return rows.map((t) => ({ id: t.id, channel: t.channel as "EMAIL" | "SMS", name: t.name, subject: t.subject, body: t.body }));
}

export type WhatsAppComposerTemplate = { kind: WhatsAppKind; label: string; name: string; params: string[] };

export async function getMessagingSettings() {
  const [email, sms, wati] = await Promise.all([getEmailRuntime(), getSmsRuntime(), getWatiRuntime()]);
  // Every touchpoint that has a template mapped in WhatsApp → Settings is offered in the
  // composer's "Use template" mode — a business-initiated WhatsApp send (outside the 24h session
  // window opened by the contact) MUST be an approved template; there is no freeform alternative.
  const templates: WhatsAppComposerTemplate[] = Object.entries(wati.settings.templates)
    .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => !!entry[1])
    .map(([kind, t]) => ({ kind: kind as WhatsAppKind, label: WHATSAPP_KIND_LABELS[kind as WhatsAppKind], name: t.name, params: t.params }));
  return {
    email: { enabled: email.enabled, configured: email.configured, envEnabled: email.envEnabled, paused: email.paused, fromEmail: email.fromEmail, fromName: email.fromName },
    sms: { enabled: sms.enabled, configured: sms.configured, envEnabled: sms.envEnabled, paused: sms.paused, fromNumber: sms.fromNumber },
    whatsapp: { enabled: wati.enabled, configured: wati.configured, templates },
  };
}
