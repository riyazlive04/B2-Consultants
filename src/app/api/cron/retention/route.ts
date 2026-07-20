import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runRetentionPurge } from "@/server/retention";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Retention purge seam (dashboard issue 7.4). Same shape and auth as the other cron routes.
 * Permanently deletes archived records older than the retention window (default 90 days). The job
 * is idempotent and safe to run often — "once a day" is the intended cadence:
 *
 *   daily  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/retention
 *
 * Auth: CRON_SECRET via `x-cron-secret`, `Authorization: Bearer <secret>`, or `?key=`.
 * Fail-closed (503) when the secret is unset.
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

  if (!rateLimitOk(`cron-retention:${clientIpFrom(req.headers)}`, 20, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const run = await runRetentionPurge();
  return NextResponse.json({ ok: true, run });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET too: many cron services can only issue a GET.
export async function GET(req: NextRequest) {
  return handle(req);
}
