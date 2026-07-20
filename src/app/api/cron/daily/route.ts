import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDailyMaintenance } from "@/server/daily-maintenance";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Daily-maintenance seam (audit §C). Same shape and auth as /api/cron/{outreach,whatsapp,workflows,
 * daily-log}. Runs the once-a-day housekeeping orchestrator: FX prewarm, OVERDUE sweep, invoice
 * issuance backfill, retention purge/sweep (once/day) and the scheduled founder digest.
 *
 * CADENCE: an hourly tick is the pragmatic choice — every sub-job is idempotent, and the hourly
 * cadence lets the scheduled-report send fire close to its configured IST time while the
 * once-per-day guards keep the destructive work to a single run:
 *
 *   0 * * * *  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/daily
 *
 * Auth: CRON_SECRET via `x-cron-secret`, `Authorization: Bearer <secret>`, or `?key=`.
 * Fail-closed (503) when the secret is unset. Each engine no-ops when disabled in settings.
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

  // An hourly tick is expected here, so this is tighter than the outreach route's 120/min.
  if (!rateLimitOk(`cron-daily:${clientIpFrom(req.headers)}`, 20, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const run = await runDailyMaintenance();
  return NextResponse.json({ ok: true, run });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET too: many cron services can only issue a GET.
export async function GET(req: NextRequest) {
  return handle(req);
}
