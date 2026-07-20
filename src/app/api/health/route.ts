import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
