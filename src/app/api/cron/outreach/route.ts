import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDueOutreach } from "@/server/outreach";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Outreach SOP scheduler seam. Same shape and auth as /api/cron/whatsapp and /api/cron/workflows.
 *
 * CADENCE MATTERS HERE MORE THAN ELSEWHERE. The SOP's tightest rule is Step 2's 5-minute reaction
 * window, and this engine's timing resolution is exactly the cron's interval — a 15-minute cron
 * cannot police a 5-minute SLA. Hit this every 1–2 minutes:
 *
 *   * * * * *  curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/outreach
 *
 * The 5-minute window is only ever *reported* late, never enforced wrongly: `reactionState` reads
 * the real clock, so a late tick shows a truthful "breached", just later than ideal. Everything
 * else in the SOP (2h/1h/36h/24h/12h/10h) is comfortably served by a 1–15 minute tick.
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

  // A 1-minute cron is expected here, so the limit is looser than the WhatsApp route's — but a
  // stuck scheduler still shouldn't be able to hammer the engine.
  if (!rateLimitOk(`cron-outreach:${clientIpFrom(req.headers)}`, 120, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const run = await runDueOutreach();
  return NextResponse.json({ ok: true, run });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET too: many cron services can only issue a GET.
export async function GET(req: NextRequest) {
  return handle(req);
}
