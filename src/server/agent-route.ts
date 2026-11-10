import "server-only";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { clientIpFrom, takeToken, RATE_RULES } from "@/lib/rate-limit";
import { captureException } from "@/lib/observability";

/**
 * Shared auth for /api/agent/* routes.
 *
 * Accepts either AGENT_SECRET (preferred — dedicated to the automated agent, rotatable independently)
 * or CRON_SECRET (fallback — so the endpoints work before a separate secret is set up). Same
 * constant-time compare, same fail-closed behaviour as cronRoute.
 */

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

export type AgentHandler = (req: NextRequest) => Promise<NextResponse>;

/**
 * Wraps an agent route handler with CRON_SECRET auth, rate limiting, and error capture.
 * The inner handler receives the authenticated request and returns a NextResponse.
 */
export function agentRoute(name: string, handler: AgentHandler): { GET: AgentHandler; POST: AgentHandler } {
  async function handle(req: NextRequest): Promise<NextResponse> {
    const agentSecret = process.env.AGENT_SECRET?.trim();
    const cronSecret = process.env.CRON_SECRET;
    if (!agentSecret && !cronSecret) {
      return NextResponse.json({ ok: false, error: "Agent API not configured" }, { status: 503 });
    }

    const provided = providedSecret(req);
    if (!provided) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const matches = (agentSecret && secretMatches(provided, agentSecret)) ||
      (cronSecret && secretMatches(provided, cronSecret));
    if (!matches) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const gate = takeToken(`agent:${name}:${clientIpFrom(req.headers)}`, RATE_RULES.cron);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: "Too many requests" }, {
        status: 429,
        headers: { "retry-after": String(gate.retryAfterSec) },
      });
    }

    try {
      return await handler(req);
    } catch (err) {
      await captureException(err, { where: `agent:${name}` });
      return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
    }
  }

  return { GET: handle, POST: handle };
}
