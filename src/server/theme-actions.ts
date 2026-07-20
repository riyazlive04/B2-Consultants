"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import type { ActionResult } from "./finance-actions";

/**
 * Per-user theme (spec Part 2 §13: "dark and light per user" — the founder prefers dark,
 * others may prefer light).
 *
 * Stored on the User row rather than in localStorage so the choice follows the person across
 * machines, and so a server-rendered page can emit the right theme on the FIRST paint instead
 * of flashing the wrong one while client JS boots.
 *
 * Anyone may set their OWN theme — this is deliberately not gated by section access. It
 * writes to the session's own user id and cannot be pointed at anyone else's row.
 */

const MODES = ["SYSTEM", "LIGHT", "DARK"] as const;
type Mode = (typeof MODES)[number];

export async function setThemePreference(mode: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!(MODES as readonly string[]).includes(mode)) return { ok: false, error: "Invalid theme" };
  await prisma.user.update({
    where: { id: session.user.id },
    data: { themePreference: mode as Mode },
  });
  // Not activity-logged: a personal display preference is noise in a who-did-what audit trail
  // that exists to answer questions about money and access.
  revalidatePath("/", "layout");
  return { ok: true };
}
