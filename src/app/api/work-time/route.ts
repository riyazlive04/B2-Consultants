import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addWorkSeconds, getMyWorkTime, resetToday } from "@/server/work-time";

/**
 * Work-time heartbeat for the app-wide tracker (components/shell/WorkTimeTracker).
 *
 * POST { seconds } -> add elapsed seconds to the caller's IST-today row.
 * GET             -> the caller's day-keyed history, for the dashboard widget.
 *
 * The user id comes from the session, never the body: a client can say how long
 * it worked, never who it worked as.
 */

async function currentUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  return session?.user.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ byDay: {}, todaySec: 0 }, { status: 401 });

  const data = await getMyWorkTime(userId);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  // sendBeacon posts a Blob, so tolerate a body that isn't valid JSON.
  let seconds = 0;
  try {
    const body = (await req.json()) as { seconds?: unknown };
    seconds = Number(body?.seconds ?? 0);
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return NextResponse.json({ ok: true, todaySec: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const todaySec = await addWorkSeconds(userId, seconds);
  return NextResponse.json({ ok: true, todaySec }, { headers: { "Cache-Control": "no-store" } });
}

/** Reset the caller's own time for today (the widget's ↺ button). Own row only. */
export async function DELETE() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  await resetToday(userId);
  return NextResponse.json({ ok: true, todaySec: 0 }, { headers: { "Cache-Control": "no-store" } });
}
