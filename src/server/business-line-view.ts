"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { BusinessLineView } from "@/lib/business-line";

/**
 * The B2 / German Note / Combined selection, made GLOBAL and PERSISTENT (Error Log E1/E4).
 *
 * It was a `?line=` search param on Finance alone, so it reset the moment you navigated
 * anywhere else - and the spec asks for one segment choice that follows you across the app.
 *
 * A COOKIE rather than client state or a param, for reasons that all matter here:
 *   • server components read it directly, so every segmented card renders correctly on the
 *     FIRST paint - no flash of combined numbers being corrected a moment later;
 *   • it survives navigation and a reload, which is the actual requirement;
 *   • it is per-browser, so one person's view never changes what a colleague sees.
 *
 * A `?line=` param still WINS when present (see `resolveBusinessLine`). Linking someone a
 * specific view was a deliberate property of the old design and losing it would be a
 * regression; the cookie is the sticky default, not an override of an explicit request.
 */

const COOKIE = "b2.line";
// A year: this is a display preference, not a credential. Re-choosing every session was the
// complaint, so the expiry has to outlast any realistic gap between logins.
const MAX_AGE = 60 * 60 * 24 * 365;

function parse(value: string | undefined): BusinessLineView | null {
  return value === "B2" || value === "GERMAN_NOTE" || value === "ALL" ? value : null;
}

/** The sticky selection. "ALL" (combined) stays the default, as it always was. */
export async function getBusinessLineView(): Promise<BusinessLineView> {
  const jar = await Promise.resolve(cookies());
  return parse(jar.get(COOKIE)?.value) ?? "ALL";
}

/**
 * What a page should actually render, given its own URL.
 *
 * Explicit beats sticky: a `?line=` in the address bar is someone asking for that view right
 * now - usually because a colleague sent them the link - and the cookie must not quietly
 * override it.
 */
export async function resolveBusinessLine(param?: string | string[]): Promise<BusinessLineView> {
  const requested = parse(Array.isArray(param) ? param[0] : param);
  return requested ?? (await getBusinessLineView());
}

/** Set the sticky selection. Called by the toggle; re-renders every segmented screen. */
export async function setBusinessLineView(next: BusinessLineView): Promise<void> {
  const value = parse(next) ?? "ALL";
  const jar = await Promise.resolve(cookies());
  jar.set(COOKIE, value, {
    maxAge: MAX_AGE,
    path: "/",
    sameSite: "lax",
    // Readable by the server only - nothing in the browser needs it, and the toggle already
    // knows its own state from the props the server rendered it with.
    httpOnly: true,
  });
  // The choice changes what several unrelated screens show, so revalidate the layout rather
  // than one route - otherwise Finance updates and the home gauge keeps its old numbers.
  revalidatePath("/", "layout");
}
