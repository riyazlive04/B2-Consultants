import "server-only";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { clientIpFrom, takeToken, RATE_RULES, type RateRule } from "@/lib/rate-limit";
import { captureException } from "@/lib/observability";
import { recordCronRun } from "./uptime";

/**
 * The shared /api/cron/* handler.
 *
 * Six cron routes had six copies of the same 30 lines: the constant-time secret compare, the
 * three ways a scheduler might present that secret, the rate limit, the GET-and-POST pair. Every
 * one of them also swallowed errors — a throw inside the engine produced an unlogged 500, which is
 * precisely the "a production error reaches you only when a client emails" problem.
 *
 * Centralising it means the three things added here — error capture, the run heartbeat, and the
 * dead-man's-switch ping — arrive on all six at once, and on the seventh (/api/cron/alerts)
 * for free.
 *
 * AUTH is unchanged: CRON_SECRET via `x-cron-secret`, `Authorization: Bearer`, or `?key=`, compared
 * in constant time, fail-closed (503) when the secret is unset.
 */

/** Constant-time comparison — a plain !== leaks length and prefix timing. */
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

export type CronHandlers = {
  GET: (req: NextRequest) => Promise<Response>;
  POST: (req: NextRequest) => Promise<Response>;
};

/**
 * Builds the GET/POST pair for a cron route.
 *
 * `job` is the heartbeat key and the rate-limit key — keep it stable, the Founder Console and
 * /api/health both read it. `rule` defaults to the shared cron bucket; a 1-minute tick like
 * outreach passes a looser one.
 */
export function cronRoute(
  job: string,
  run: () => Promise<unknown>,
  rule: RateRule = RATE_RULES.cron,
): CronHandlers {
  async function handle(req: NextRequest): Promise<Response> {
    const secret = process.env.CRON_SECRET;
    if (!secret) return new Response("Cron not configured", { status: 503 });

    const provided = providedSecret(req);
    if (!provided || !secretMatches(provided, secret)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const gate = takeToken(`cron:${job}:${clientIpFrom(req.headers)}`, rule);
    if (!gate.ok) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": String(gate.retryAfterSec) },
      });
    }

    try {
      const result = await run();
      // Awaited, unlike in a request path: nobody is waiting on this response, and losing the
      // heartbeat to process exit would defeat the point of having one.
      await recordCronRun(job, { ok: true });
      return NextResponse.json({ ok: true, run: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await captureException(err, { where: `cron:${job}` });
      await recordCronRun(job, { ok: false, error: message });
      // 500 so the scheduler's own logs show a failure too, and the message stays out of the
      // body — cron errors in this app routinely embed the connection string.
      return NextResponse.json({ ok: false, error: "Cron job failed" }, { status: 500 });
    }
  }

  return {
    GET: handle, // many cron services can only issue a GET
    POST: handle,
  };
}
