import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { MessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Inbound Twilio webhook — two jobs, mirroring the WATI webhook's shape (see
 * api/wati/webhook/route.ts):
 *  1. Genuine inbound SMS. Twilio POSTs Body/From/To (form-encoded) the moment a reply arrives —
 *     this needs NO extra infrastructure beyond pointing the number's "A message comes in" webhook
 *     at this URL in the Twilio console. Logged as an INBOUND Message row, matched to a Lead by
 *     phone number.
 *  2. Delivery-status callbacks (queued/sent/delivered/failed/undelivered) → advance the matching
 *     Message row, matched by externalId (the Twilio MessageSid stored at send time in
 *     server/messaging.ts's sendSmsMessage — Twilio hands us this id up front, so the match is
 *     exact). NOTE: this half is implemented and ready but currently dormant — `src/lib/sms.ts`
 *     (marked read-only reference for this pass) never sets a `StatusCallback` param on outbound
 *     sends, so Twilio has no URL to call back to yet. Either add `StatusCallback` to the
 *     sendTwilioSms POST body, or set this URL as the Messaging Service's default status-callback
 *     URL in the Twilio console — both are one-line, no-code-change options.
 *
 * Auth: Twilio signs every request with X-Twilio-Signature — HMAC-SHA1 over
 * "{webhook URL}{sorted POST params, key+value pairs concatenated, no separators}", keyed with the
 * account's own TWILIO_AUTH_TOKEN (the existing outbound-sending credential doubles as the signing
 * key — no separate webhook secret to provision). Fail-closed (503) when TWILIO_AUTH_TOKEN is unset.
 * The URL used for signing is reconstructed from X-Forwarded-Proto/Host (this app sits behind a
 * reverse proxy on the VPS — see lib/rate-limit.ts) and must exactly match, byte-for-byte with no
 * query string, the webhook URL configured in Twilio's console, or the signature legitimately won't
 * match — that's Twilio's protection working as intended, not a bug here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function externalUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}${req.nextUrl.pathname}`;
}

function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string, authToken: string): boolean {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  const expected = crypto.createHmac("sha1", authToken).update(url + sorted).digest("base64");
  try {
    const given = Buffer.from(signature, "base64");
    const exp = Buffer.from(expected, "base64");
    return given.length === exp.length && crypto.timingSafeEqual(given, exp);
  } catch {
    return false;
  }
}

const STATUS_RANK: Record<MessageStatus, number> = { SKIPPED: 0, QUEUED: 1, SENT: 2, DELIVERED: 3, FAILED: 2 };

function mapTwilioStatus(raw: string): MessageStatus | null {
  switch (raw.toLowerCase()) {
    case "queued":
    case "accepted":
      return "QUEUED";
    case "sending":
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "failed":
    case "undelivered":
      return "FAILED";
    default:
      return null; // "receiving" / "received" are inbound-side statuses, not relevant here
  }
}

async function handleStatus(sid: string, status: MessageStatus, errorCode: string | null): Promise<void> {
  const row = await prisma.message.findFirst({
    where: { externalId: sid, channel: "SMS", direction: "OUTBOUND" },
    select: { id: true, status: true },
  });
  if (!row) return;
  if (status !== "FAILED" && STATUS_RANK[status] <= STATUS_RANK[row.status]) return;
  await prisma.message.update({ where: { id: row.id }, data: { status, ...(errorCode ? { error: `Twilio error ${errorCode}` } : {}) } });
}

/**
 * Match the inbound sender to a Lead. Twilio's `From` always arrives in strict E.164. Stored
 * Lead.phone is not always — lead-intake.ts's own dedup logic does a plain exact match on
 * `Lead.phone`, so this mirrors that first, then falls back to de-formatted variants (bare digits,
 * last-10 national number) rather than inventing a new normalization scheme for this one route.
 */
async function findLeadIdByPhone(fromE164: string): Promise<string | null> {
  const bare = fromE164.replace(/^\+/, "");
  const national10 = bare.slice(-10);
  const lead = await prisma.lead.findFirst({
    where: { OR: [{ phone: fromE164 }, { phone: bare }, { phone: { endsWith: national10 } }] },
    select: { id: true },
  });
  return lead?.id ?? null;
}

async function handleInbound(from: string, to: string, body: string, sid: string | null): Promise<void> {
  const leadId = await findLeadIdByPhone(from);
  await prisma.message.create({
    data: {
      channel: "SMS",
      direction: "INBOUND",
      status: "DELIVERED", // "arrived" — INBOUND rows have no send outcome of their own
      leadId,
      toAddress: from, // counterparty's address, matching the OUTBOUND convention (toAddress = the other party)
      fromAddress: to || null,
      body: body.slice(0, 2000) || "(empty message)",
      provider: "twilio",
      externalId: sid,
      read: false,
    },
  });
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) return new Response("Webhook not configured", { status: 503 });

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return new Response("Unauthorized", { status: 401 });

  if (!rateLimitOk(`twilio:${clientIpFrom(req.headers)}`, 300, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  if (!verifyTwilioSignature(externalUrl(req), params, signature, authToken)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const messageStatus = params.MessageStatus;
  const body = params.Body;
  const from = params.From;
  const to = params.To;
  const sid = params.MessageSid || params.SmsSid || null;

  try {
    if (messageStatus) {
      const status = mapTwilioStatus(messageStatus);
      if (status && sid) await handleStatus(sid, status, params.ErrorCode || null);
    } else if (typeof body === "string" && from) {
      await handleInbound(from, to ?? "", body, sid);
    }
  } catch {
    // Never fail the webhook on a processing hiccup — Twilio would retry-storm.
  }

  // Twilio parses the response as TwiML for the "message comes in" webhook; an empty <Response/>
  // means "don't auto-reply." Status-callback requests ignore the response body entirely, so one
  // reply shape safely serves both cases.
  return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
}
