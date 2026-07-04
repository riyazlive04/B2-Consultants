import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { AppRole } from "@/lib/rbac";
import { computeNotifications } from "@/server/notifications";

/**
 * Scoped notification feed for the top-bar bell's live polling.
 * The bell used to call router.refresh() on a timer, which re-ran the WHOLE
 * force-dynamic route (layout + page, ~20 queries per poll per tab). This returns
 * ONLY the notification list, so a poll costs just computeNotifications().
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (!session) return NextResponse.json({ items: [] }, { status: 401 });

  const role = (session.user as { role?: string }).role as AppRole;
  const items = await computeNotifications(role, session.user.id);
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } },
  );
}
