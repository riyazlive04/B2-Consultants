import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDueReminders } from "@/server/whatsapp";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Scheduled reminder trigger. An external scheduler (Hostinger cron / crontab / Vercel Cron /
 * cron-job.org) hits this every ~15 min; it runs the due WhatsApp reminders and returns a summary.
 * The app deliberately has no long-running worker — this endpoint IS the scheduler seam. It's also
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
  return NextResponse.json({ ok: true, run });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET too: many cron services can only issue a GET.
export async function GET(req: NextRequest) {
  return handle(req);
}
