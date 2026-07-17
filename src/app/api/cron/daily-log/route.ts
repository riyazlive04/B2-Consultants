import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDailyLogEod } from "@/server/daily-log-eod";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Daily-log EOD seam. Same shape and auth as /api/cron/outreach, /api/cron/whatsapp and
 * /api/cron/workflows.
 *
 * CADENCE: unlike the outreach route, this one does NOT need a tight tick. The job is a no-op
 * until the founder's cutoff passes and is idempotent afterwards, so anything from "once, just
 * after the cutoff" to "every 15 minutes all day" produces the same rows. A ~15-minute tick is
 * the pragmatic choice — it means a laptop asleep at exactly 9:00 PM still auto-saves when it
 * wakes, instead of missing the day entirely:
 *
 *   every 15 min  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/daily-log
 *
 * The CUTOFF itself does not depend on this route: submitDailyLog reads the real clock, so the
 * deadline is enforced whether or not anything ever ticks. Only auto-save needs the cron.
 *
 * Auth: CRON_SECRET via `x-cron-secret`, `Authorization: Bearer <secret>`, or `?key=`.
 * Fail-closed (503) when the secret is unset. The engine itself no-ops when disabled in settings.
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

  // A 15-minute tick is expected here, so this is tighter than the outreach route's 120/min.
  if (!rateLimitOk(`cron-daily-log:${clientIpFrom(req.headers)}`, 20, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const run = await runDailyLogEod();
  return NextResponse.json({ ok: true, run });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET too: many cron services can only issue a GET.
export async function GET(req: NextRequest) {
  return handle(req);
}
