import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { WhatsAppStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { takeToken, tooManyRequests, RATE_RULES } from "@/lib/rate-limit";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { readWatiSettings } from "@/lib/wati";
import { isConfirmationReply } from "@/lib/confirmation-reply";
import { markDiscoveryConfirmed } from "@/server/lead-stage-auto";
import { isTerminal } from "@/lib/outreach-engine";
import { markSopDiscoConfirmed } from "@/server/outreach";

/**
 * Inbound WATI webhook - two jobs:
 *  1. Delivery-status callbacks (sent / delivered / read / failed) → advance the matching
 *     WhatsAppMessage row by its watiMessageId.
 *  2. Incoming replies → mark the last outbound message to that number REPLIED (the SALES-LOGIC
 *     "WhatsApp confirmed" signal), log an INBOUND row, and honour STOP/opt-out.
 *
 * Auth mirrors the FlexiFunnels webhook: shared secret via `x-webhook-secret` header or `?key=`,
 * constant-time compared, fail-closed (503) when unset, rate-limited. Always answers 200 after auth
 * so WATI doesn't enter a retry storm on a payload shape we didn't recognise.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(provided: string, secret: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Case-insensitive first-hit string pick across a flat object. */
function pick(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

const STATUS_RANK: Record<WhatsAppStatus, number> = {
  SKIPPED: 0, QUEUED: 1, SENT: 2, DELIVERED: 3, READ: 4, REPLIED: 5, FAILED: 2,
};

function mapStatus(raw: string | undefined): WhatsAppStatus | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes("read") || t.includes("seen")) return "READ";
  if (t.includes("deliver")) return "DELIVERED";
  if (t.includes("fail") || t.includes("undeliver") || t.includes("error")) return "FAILED";
  if (t.includes("sent")) return "SENT";
  return null;
}

function isStopMessage(text: string): boolean {
  return /^\s*(stop|unsubscribe|opt[\s-]?out|cancel|remove me)\b/i.test(text);
}


/**
 * Apply a delivery-status callback.
 *
 * WATI's `sendTemplateMessage` response does NOT return a message id (verified against the live
 * API: it answers `{result: true, info: "Success"}`), so `watiMessageId` is usually null on our
 * rows and matching by id alone would silently drop every status update. We therefore fall back to
 * the most recent OUTBOUND message to that number - which is what the callback is about.
 * If the callback carries an id and we can back-fill it, we do, so later callbacks match exactly.
 */
async function handleStatus(watiId: string | undefined, sender: string | null, status: WhatsAppStatus): Promise<void> {
  let row =
    watiId
      ? await prisma.whatsAppMessage.findFirst({
          where: { watiMessageId: watiId, direction: "OUTBOUND" },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, watiMessageId: true },
        })
      : null;

  if (!row && sender) {
    row = await prisma.whatsAppMessage.findFirst({
      where: { toNumber: sender, direction: "OUTBOUND" },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, watiMessageId: true },
    });
  }
  if (!row) return;

  // Never regress a message that already replied; only advance status otherwise.
  if (row.status === "REPLIED") return;
  if (status !== "FAILED" && STATUS_RANK[status] <= STATUS_RANK[row.status]) return;

  await prisma.whatsAppMessage.update({
    where: { id: row.id },
    data: { status, ...(watiId && !row.watiMessageId ? { watiMessageId: watiId } : {}) },
  });
}

/**
 * Apply a prospect's YES to whichever confirmation ladder is currently open for them.
 *
 * Which flag it sets depends on which APPOINTMENT is still ahead of them, not on the message: a
 * YES while a discovery call is upcoming is "WhatsApp Confirmed" (Steps 14/15), a YES while the
 * SSS ladder is open is "Sales Call Confirmed" (Steps 19/20). A YES at any other time is just
 * friendliness and sets nothing.
 *
 * It used to key off `phase === "DISCO_CONFIRMATION"` alone, and that phase is only reached once
 * Step 12 (a manual Key Metrics transfer into a sheet this app cannot see) has been ticked. So a
 * prospect who replied YES the moment they got the welcome message was recorded as having said
 * nothing: the 36h and 24h reminders still went out, and the post-call sweep then wrote their
 * CONFIRMED booking off as a no-show. The gate is now the fact that decides whether the messages
 * make sense - is the call still ahead of us - with the phase kept only as a terminal guard, so a
 * cancelled or written-off journey is never revived by a late reply.
 */
async function confirmJourneyFor(leadId: string): Promise<void> {
  const journey = await prisma.outreachJourney.findUnique({
    where: { leadId },
    select: {
      id: true,
      phase: true,
      whatsappConfirmed: true,
      salesCallConfirmed: true,
      highlyQualified: true,
      sssAt: true,
      booking: { select: { status: true, slot: { select: { startsAt: true } } } },
    },
  });
  if (!journey || isTerminal(journey.phase)) return;

  const now = new Date();
  // The SSS ladder is open from the Highly Qualified verdict with a time on the diary, which is
  // exactly what `planJourney` gates its SSS steps on - the two must agree or a YES lands on the
  // wrong appointment.
  const sssOpen =
    journey.phase === "SSS_CONFIRMATION" || (journey.highlyQualified === true && journey.sssAt !== null);
  const discoUpcoming =
    journey.booking?.status === "BOOKED" &&
    journey.booking.slot !== null &&
    journey.booking.slot.startsAt.getTime() > now.getTime();

  if (sssOpen && !journey.salesCallConfirmed) {
    await prisma.outreachJourney.update({
      where: { id: journey.id },
      data: { salesCallConfirmed: true, salesCallConfirmedAt: now },
    });
  } else if (discoUpcoming && !journey.whatsappConfirmed) {
    const recorded = await markSopDiscoConfirmed(journey.id);
    // The flag alone was invisible on the board. This is the prospect saying yes, which is
    // precisely what "Pre-Qualified & Confirmed" means - see markDiscoveryConfirmed.
    if (recorded) await markDiscoveryConfirmed(leadId, "whatsapp").catch(() => undefined);
  }
}

/**
 * Apply a prospect's YES to their upcoming booking (Bookings confirmation loop, Module E). Sets
 * `confirmedAt`, which is exactly what stops the auto-cancel engine from releasing the slot. Only a
 * live BOOKED, still-unconfirmed booking is touched - a YES after the fact changes nothing.
 */
async function confirmBookingFor(bookingRequestId: string): Promise<void> {
  const b = await prisma.bookingRequest.findUnique({
    where: { id: bookingRequestId },
    select: { status: true, confirmedAt: true },
  });
  if (!b || b.confirmedAt || b.status !== "BOOKED") return;
  await prisma.bookingRequest.update({ where: { id: bookingRequestId }, data: { confirmedAt: new Date() } });
}

async function handleInbound(sender: string, text: string): Promise<void> {
  // Link the reply to whatever we last sent this number, so the pipeline badge + history connect.
  const lastOutbound = await prisma.whatsAppMessage.findFirst({
    where: { toNumber: sender, direction: "OUTBOUND" },
    orderBy: { createdAt: "desc" },
    select: { id: true, leadId: true, studentId: true, bookingRequestId: true, pendingPaymentId: true },
  });

  const stop = isStopMessage(text);
  if (stop) {
    await prisma.whatsAppOptOut.upsert({
      where: { phone: sender },
      create: { phone: sender, reason: `STOP reply: "${text.slice(0, 120)}"` },
      update: { reason: `STOP reply: "${text.slice(0, 120)}"` },
    });
  } else if (lastOutbound) {
    // A reply marks the outbound thread REPLIED - that is a delivery fact and stays as it was.
    await prisma.whatsAppMessage.update({ where: { id: lastOutbound.id }, data: { status: "REPLIED" } });

    // …but REPLIED is NOT the same as confirmed. The SOP's "WhatsApp Confirmed" / "Sales Call
    // Confirmed" columns (and the booking's confirmedAt) mean the prospect said yes, so only an
    // actual YES flips them. Anything else stays a reply for a human to read.
    if (isConfirmationReply(text)) {
      if (lastOutbound.leadId) await confirmJourneyFor(lastOutbound.leadId);
      if (lastOutbound.bookingRequestId) await confirmBookingFor(lastOutbound.bookingRequestId);
    }
  }

  await prisma.whatsAppMessage.create({
    data: {
      direction: "INBOUND",
      kind: "MANUAL",
      status: "REPLIED",
      toNumber: sender,
      body: text.slice(0, 2000),
      error: stop ? "Opted out (STOP)" : null,
      leadId: lastOutbound?.leadId ?? null,
      studentId: lastOutbound?.studentId ?? null,
      bookingRequestId: lastOutbound?.bookingRequestId ?? null,
      pendingPaymentId: lastOutbound?.pendingPaymentId ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.WATI_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });

  const provided = req.headers.get("x-webhook-secret") ?? req.nextUrl.searchParams.get("key");
  if (!provided || !secretMatches(provided, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Endpoint-keyed, not IP-keyed - every callback comes from WATI's own egress, so a per-IP
  // bucket was a global bucket that would silently reset on a vendor IP change. High ceiling
  // because this route is chatty by design (a delivery-status callback per message), and
  // `Retry-After` so a throttled callback is retried rather than dropped: losing a status
  // callback is how a SENT message quietly stays SENT forever.
  const gate = takeToken("webhook:wati", RATE_RULES.watiWebhook);
  if (!gate.ok) return tooManyRequests(gate.retryAfterSec);

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const settings = await readWatiSettings();
  const eventType = pick(body, "eventType", "type", "event") ?? "";
  const owner = body.owner; // WATI: true = message the business sent (outbound), false/undefined = customer
  const text = pick(body, "text", "message", "body") ?? "";
  const senderRaw = pick(body, "waId", "senderPhone", "phone_number", "whatsappNumber", "from");
  const sender = normalizeWhatsappNumber(senderRaw, settings.defaultCountry);
  const watiId = pick(body, "id", "messageId", "whatsappMessageId", "ticketId");
  const statusStr = pick(body, "status", "statusString", "eventType", "type");

  const looksInbound = owner === false || (!!text && !!sender && owner !== true && !/status/i.test(eventType));
  const mapped = mapStatus(statusStr);

  try {
    if (looksInbound && sender && text) {
      await handleInbound(sender, text);
    } else if (mapped && (watiId || sender)) {
      await handleStatus(watiId, sender, mapped);
    }
  } catch {
    // Never fail the webhook on a processing hiccup - WATI would retry-storm. Swallow + 200.
  }

  return NextResponse.json({ ok: true });
}
