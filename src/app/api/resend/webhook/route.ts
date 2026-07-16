import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { MessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Inbound Resend webhook — Resend signs its webhook deliveries via Svix. Two jobs, mirroring the
 * WATI webhook's shape (see api/wati/webhook/route.ts):
 *  1. Delivery-status events (email.sent / .delivered / .bounced / .failed / .complained) → advance
 *     the matching Message row, matched by externalId (the Resend email id we stored at send time
 *     in server/messaging.ts's sendEmailMessage — unlike WATI, Resend DOES hand us an id up front,
 *     so this match is exact, no toNumber/recency fallback needed).
 *  2. `email.received` — a genuine inbound reply. **This is a real, working Resend feature as of
 *     2025/2026 ("Inbound")**, but the webhook payload carries METADATA ONLY (no body) — we fetch
 *     the actual content via Resend's Received Emails API (GET /emails/receiving/{id}, needs
 *     RESEND_API_KEY) and log an INBOUND Message row, matched to a Lead by the sender's address.
 *
 *     The one thing code alone can't finish: `email.received` never fires until an operator points a
 *     receiving address at Resend in their dashboard — either the free `<id>.resend.app` address, or
 *     MX records on a real (ideally dedicated sub-)domain. Until that one-time setup happens, this
 *     route still works fully for the six delivery-status events, which need nothing beyond
 *     registering this URL + a signing secret under Resend → Webhooks.
 *
 * Auth: svix-id / svix-timestamp / svix-signature headers; HMAC-SHA256 over
 * "{svix-id}.{svix-timestamp}.{raw body}" keyed with the base64 portion of RESEND_WEBHOOK_SECRET
 * (the "whsec_..." value Resend shows when you create the endpoint), constant-time compared,
 * fail-closed (503) when unset. A >5-minute-stale timestamp is rejected too (replay protection).
 * Always answers 200 after auth so Resend doesn't enter a retry storm on an event shape we didn't
 * recognise, exactly like the WATI webhook.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOLERANCE_SECONDS = 300;

function verifySvixSignature(rawBody: string, svixId: string, svixTimestamp: string, svixSignature: string, secret: string): boolean {
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest();

  // svix-signature carries space-separated "v1,<base64sig>" entries (one per active signing key,
  // e.g. during secret rotation) — any match is valid.
  return svixSignature.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    try {
      const given = Buffer.from(sig, "base64");
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    } catch {
      return false;
    }
  });
}

const STATUS_RANK: Record<MessageStatus, number> = { SKIPPED: 0, QUEUED: 1, SENT: 2, DELIVERED: 3, FAILED: 2 };

function mapResendStatus(type: string): MessageStatus | null {
  switch (type) {
    case "email.sent":
      return "SENT";
    case "email.delivered":
      return "DELIVERED";
    case "email.bounced":
    case "email.failed":
    case "email.complained":
      return "FAILED";
    default:
      // opened / clicked / delivery_delayed / scheduled / suppressed — nothing Message.status tracks.
      return null;
  }
}

/** Never regress a row that's already reached a later state (e.g. a delayed "sent" arriving after
 *  "delivered"); FAILED can always land, same rule the WATI webhook uses. */
async function handleStatus(emailId: string, status: MessageStatus, detail: string | null): Promise<void> {
  const row = await prisma.message.findFirst({
    where: { externalId: emailId, channel: "EMAIL", direction: "OUTBOUND" },
    select: { id: true, status: true },
  });
  if (!row) return;
  if (status !== "FAILED" && STATUS_RANK[status] <= STATUS_RANK[row.status]) return;
  await prisma.message.update({ where: { id: row.id }, data: { status, ...(detail ? { error: detail } : {}) } });
}

async function findLeadIdByEmail(email: string): Promise<string | null> {
  const lead = await prisma.lead.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  return lead?.id ?? null;
}

type ReceivedEmail = { from: string; to: string[]; subject: string | null; html: string | null; text: string | null };

/** GET /emails/receiving/{id} — the only way to get the actual body; the webhook payload is
 *  metadata-only. Never throws; a fetch failure just means we fall back to the webhook's own
 *  metadata for the row. */
async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      from: typeof data.from === "string" ? data.from : "",
      to: Array.isArray(data.to) ? (data.to as string[]) : [],
      subject: typeof data.subject === "string" ? data.subject : null,
      html: typeof data.html === "string" ? data.html : null,
      text: typeof data.text === "string" ? data.text : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function htmlToText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function handleReceived(emailId: string, fallbackFrom: string, fallbackSubject: string | null): Promise<void> {
  const full = await fetchReceivedEmail(emailId);
  const from = (full?.from || fallbackFrom || "").trim();
  if (!from) return;

  const body = (full?.text || (full?.html ? htmlToText(full.html) : "") || "").slice(0, 5000);
  const subject = full?.subject ?? fallbackSubject;
  const leadId = await findLeadIdByEmail(from);

  await prisma.message.create({
    data: {
      channel: "EMAIL",
      direction: "INBOUND",
      status: "DELIVERED", // "arrived" — INBOUND rows have no send outcome of their own
      leadId,
      toAddress: from, // counterparty's address, matching the OUTBOUND convention (toAddress = the other party)
      fromAddress: full?.to?.[0] ?? null,
      subject,
      body: body || "(no body)",
      provider: "resend",
      externalId: emailId,
      read: false,
    },
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return new Response("Unauthorized", { status: 401 });

  if (!rateLimitOk(`resend:${clientIpFrom(req.headers)}`, 300, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  // Raw text, not req.json() — the signature is computed over the exact bytes on the wire.
  const rawBody = await req.text();
  if (!verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    payload = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const type = typeof payload.type === "string" ? payload.type : "";
  const data = (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
  const emailId = typeof data.email_id === "string" ? data.email_id : null;

  try {
    if (type === "email.received" && emailId) {
      const from = typeof data.from === "string" ? data.from : "";
      const subject = typeof data.subject === "string" ? data.subject : null;
      await handleReceived(emailId, from, subject);
    } else if (emailId) {
      const status = mapResendStatus(type);
      if (status) {
        const detail = type === "email.bounced" || type === "email.complained" || type === "email.failed" ? type.replace("email.", "") : null;
        await handleStatus(emailId, status, detail);
      }
    }
  } catch {
    // Never fail the webhook on a processing hiccup — Resend would retry-storm.
  }

  return NextResponse.json({ ok: true });
}
