import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDueReminders } from "@/server/whatsapp";
import { runBookingConfirmations } from "@/server/booking-automation";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Scheduled reminder trigger. An external scheduler (Hostinger cron / crontab / Vercel Cron /
 * cron-job.org) hits this every ~15 min; it runs the due WhatsApp reminders AND the bookings
 * confirmation loop (confirm-or-cancel + promote-next), returning a summary of both. One cron
 * entry drives all of the app's outbound cadence — there is no long-running worker. It's also
 * what the Admin "Run reminders now" button calls (via the server action).
 *
 * Auth: CRON_SECRET via `x-cron-secret` header, `Authorization: Bearer <secret>`, or `?key=`.
 * Fail-closed (503) when the secret is unset; the reminder engine itself no-ops when WATI is off.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time comparison — a plain !== leaks length/prefix timing. */
function secretMatches(provided: string, secret: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

function providedSecret(req: NextRequest): string | null {
  const bearer = req.headers.get("authorization");
  const fromBearer = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null;
  return req.headers.get("x-cron-secret") ?? fromBearer ?? req.nextUrl.searchParams.get("key");
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Cron not configured", { status: 503 });

  const provided = providedSecret(req);
  if (!provided || !secretMatches(provided, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // A stuck/duplicated cron shouldn't be able to hammer the send loop.
  if (!rateLimitOk(`cron-wa:${clientIpFrom(req.headers)}`, 60, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const run = await runDueReminders();
  // Same tick, same seam: drive the bookings confirmation loop. Independently guarded (it no-ops
  // when the loop is off), and it never throws into this handler.
  const bookings = await runBookingConfirmations().catch((e) => ({ error: String(e) }));
  return NextResponse.json({ ok: true, run, bookings });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET too: many cron services can only issue a GET.
export async function GET(req: NextRequest) {
  return handle(req);
}
