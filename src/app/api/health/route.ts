import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { channelStates } from "@/lib/env";
import { cronHealth } from "@/server/uptime";
import { errorCountLastHour, observabilityRuntime } from "@/lib/observability";

/**
 * Liveness + readiness probe for the container platform and the reverse proxy.
 *
 * This deliberately touches the database. A process that is up but cannot reach
 * Supabase is NOT ready to serve - every page in the app is server-rendered off
 * Prisma, so "the port is open" is not a useful signal on its own.
 *
 * Public by design (registered in middleware's PUBLIC_PREFIXES) and returns no
 * data: just ok/degraded plus a latency number. Nothing here is worth
 * authenticating, and nothing here leaks schema, counts or config.
 *
 * `channels` reports whether each outbound channel is armed - a booleans-only summary, no
 * endpoints, tokens or counts, so it stays safe to expose unauthenticated. It exists because
 * "off" and "on but broken" are indistinguishable from outside the app, and that ambiguity is
 * how agreement OTPs went undelivered for weeks while every screen looked fine.
 *
 * `crons` extends that same idea to the schedulers. In this app EVERY engine is cron-ticked, so a
 * container that is up while nothing is calling its cron routes is healthy and useless at the same
 * time. Ages and failure counts only - no business data. `errors` is a count, never the messages.
 *
 * IMPORTANT: a stale cron does NOT make the probe 503. This endpoint is what Caddy and Docker use
 * to decide whether to route traffic here, and "the scheduler on the host stopped" is not a reason
 * to take the web app out of rotation. Staleness is reported for a human (and the external monitor)
 * to act on; only an unreachable database degrades the status.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    // Cheapest possible round-trip that still proves the pooler is answering.
    await prisma.$queryRaw`SELECT 1`;

    const crons = await cronHealth();
    const obs = observabilityRuntime();

    return NextResponse.json({
      status: "ok",
      db: "up",
      latencyMs: Date.now() - started,
      channels: channelStates(),
      errorTracking: obs.armed ? "armed" : "off",
      errorsLastHour: errorCountLastHour(),
      crons: crons.map((c) => ({
        job: c.job,
        ageMinutes: c.ageMinutes,
        stale: c.stale,
        neverRun: c.neverRun,
        consecutiveFailures: c.consecutiveFailures,
      })),
      cronsStale: crons.filter((c) => c.stale || c.neverRun).map((c) => c.job),
    });
  } catch {
    // 503 so Caddy/Docker mark the container unhealthy rather than routing to it.
    // The error itself is logged, never returned - it embeds the connection string.
    return NextResponse.json(
      { status: "degraded", db: "down", latencyMs: Date.now() - started },
      { status: 503 },
    );
  }
}
