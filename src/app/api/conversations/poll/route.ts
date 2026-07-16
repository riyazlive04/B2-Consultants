import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Scoped "is there anything new" signal for the Conversations inbox's live polling.
 * Mirrors /api/notifications' fix for the same problem: a naive router.refresh() timer re-runs the
 * WHOLE force-dynamic page (getInboxThreads' two 400-row fetches + joins) every poll, per open tab.
 * This returns a cheap fingerprint instead — two indexed MAX(createdAt) aggregates + an unread
 * count — so the client only pays for a real getInboxThreads refetch when something actually
 * changed since its last poll.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (!session) return NextResponse.json({ latestAt: null, unread: 0 }, { status: 401 });

  const [msgMax, waMax, unread] = await Promise.all([
    prisma.message.aggregate({ _max: { createdAt: true } }),
    prisma.whatsAppMessage.aggregate({ _max: { createdAt: true } }),
    prisma.message.count({ where: { direction: "INBOUND", read: false } }),
  ]);
  const stamps = [msgMax._max.createdAt, waMax._max.createdAt].filter((d): d is Date => d !== null);
  const latestAt = stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))).toISOString() : null;

  return NextResponse.json({ latestAt, unread }, { headers: { "Cache-Control": "no-store" } });
}
