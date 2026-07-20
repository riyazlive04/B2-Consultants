import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";

/**
 * "A new lead just landed for you" — the feed behind the 30s in-app popup.
 *
 * Scoped and deliberately tiny: this is polled every 30s per open tab, so it must never grow
 * into a page-worth of queries. It returns only leads ASSIGNED TO THE CALLER that arrived
 * after `since`, which is why it can't leak another telecaller's pipeline.
 *
 * Why polling and not SSE/websockets: the app has no real-time transport at all, and a
 * persistent connection is the fragile thing on a phone that sleeps and switches networks.
 * A 30s poll of one indexed query (`@@index([assignedToId])`) is cheap and self-healing —
 * the same trade-off /api/conversations/poll and the notification bell already make.
 */

/** Hard cap: a popup naming 200 leads is not a popup. */
const MAX = 5;

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (!session) return NextResponse.json({ leads: [] }, { status: 401 });

  const sinceRaw = new URL(req.url).searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  // No/!valid `since` → return nothing rather than everything. The client sends its own
  // start-of-poll timestamp; a client that forgets shouldn't get the whole back-catalogue
  // dumped into a popup on first load.
  if (!since || Number.isNaN(since.getTime())) {
    return NextResponse.json({ leads: [], now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }

  const rows = await prisma.lead.findMany({
    where: { ...ACTIVE, assignedToId: session.user.id, createdAt: { gt: since } },
    orderBy: { createdAt: "desc" },
    take: MAX,
    select: { id: true, name: true, phone: true, city: true, leadSource: true, createdAt: true },
  });

  return NextResponse.json(
    {
      leads: rows.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        city: l.city,
        leadSource: l.leadSource,
        createdAt: l.createdAt.toISOString(),
      })),
      // The server's clock is the cursor, so a client whose clock is skewed (or asleep)
      // can't skip leads or re-announce old ones.
      now: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
