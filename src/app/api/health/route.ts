import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { channelStates } from "@/lib/env";

/**
 * Liveness + readiness probe for the container platform and the reverse proxy.
 *
 * This deliberately touches the database. A process that is up but cannot reach
 * Supabase is NOT ready to serve — every page in the app is server-rendered off
 * Prisma, so "the port is open" is not a useful signal on its own.
 *
 * Public by design (registered in middleware's PUBLIC_PREFIXES) and returns no
 * data: just ok/degraded plus a latency number. Nothing here is worth
 * authenticating, and nothing here leaks schema, counts or config.
 *
 * `channels` reports whether each outbound channel is armed — a booleans-only summary, no
 * endpoints, tokens or counts, so it stays safe to expose unauthenticated. It exists because
 * "off" and "on but broken" are indistinguishable from outside the app, and that ambiguity is
 * how agreement OTPs went undelivered for weeks while every screen looked fine.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    // Cheapest possible round-trip that still proves the pooler is answering.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "up",
      latencyMs: Date.now() - started,
      channels: channelStates(),
    });
  } catch {
    // 503 so Caddy/Docker mark the container unhealthy rather than routing to it.
    // The error itself is logged, never returned — it embeds the connection string.
    return NextResponse.json(
      { status: "degraded", db: "down", latencyMs: Date.now() - started },
      { status: 503 },
    );
  }
}
