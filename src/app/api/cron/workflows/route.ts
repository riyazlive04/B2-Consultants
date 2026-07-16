import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDueWorkflows } from "@/server/automation";
import { clientIpFrom, rateLimitOk } from "@/lib/rate-limit";

/**
 * Scheduled automation runner. An external scheduler hits this every ~5-15 min; it resumes every
 * workflow enrollment whose WAIT has elapsed (and any freshly-created ones). Same seam + auth as
 * the WhatsApp cron. Fail-closed (503) when CRON_SECRET is unset.
 *
 * Auth: CRON_SECRET via `x-cron-secret` header, `Authorization: Bearer <secret>`, or `?key=`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (!rateLimitOk(`cron-wf:${clientIpFrom(req.headers)}`, 60, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }

  const run = await runDueWorkflows();
  return NextResponse.json({ ok: true, run });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
