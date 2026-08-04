"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { normalizePassword } from "@/lib/credentials";
import { logActivity } from "./activity-log";
import type { AppRole } from "@/lib/sections";
import type { ActionResult } from "./finance-actions";

/**
 * A signed-in user changes their OWN password (O4's forced-change flow, and a plain
 * change-password page for anyone else).
 *
 * Fetches the session directly rather than through `requireSession`, on purpose: that guard
 * bounces anyone with `mustChangePassword` to /change-password, so calling it here — from the very
 * action that clears the flag — would loop.
 *
 * Verifies the CURRENT password (better-auth's changePassword throws on a mismatch), so a
 * left-open session can't be used to seize the account without knowing the temporary password the
 * admin set. The flag is cleared only AFTER the change succeeds; if the clear ever failed, the user
 * is simply asked once more with their new password as the current one — never locked out.
 */
export async function changeOwnPassword(form: FormData): Promise<ActionResult> {
  const hdrs = await Promise.resolve(headers());
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session) return { ok: false, error: "Your session has expired — sign in again." };

  /**
   * Both passwords are edge-trimmed, for the same reason the sign-in form trims.
   *
   * `currentPassword` is very often PASTED — it is the admin-set password the person was sent
   * over WhatsApp, and this screen is where a forced change happens — so it carries a trailing
   * space more often than anywhere else in the app. Untrimmed, that produced "That current
   * password is incorrect." for the exact credential we had just issued them.
   *
   * `newPassword` is trimmed so what is stored is what they can type back tomorrow.
   */
  const currentPassword = normalizePassword(String(form.get("currentPassword") ?? ""));
  const newPassword = normalizePassword(String(form.get("newPassword") ?? ""));
  if (newPassword.length < 8) return { ok: false, error: "New password must be at least 8 characters." };
  if (currentPassword === newPassword) {
    return { ok: false, error: "Choose a password different from your current one." };
  }

  try {
    // revokeOtherSessions: after a forced change, drop every other device that was signed in with
    // the admin-set password — only the session making this change survives.
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: hdrs,
    });
  } catch {
    // better-auth returns a 400 on a wrong current password; anything else is treated the same
    // to avoid leaking which part failed.
    return { ok: false, error: "That current password is incorrect." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { mustChangePassword: false },
  });

  await logActivity(
    { role: (session.user as { role?: AppRole }).role ?? "USER", user: session.user },
    {
      action: "user.password.changed",
      // Same section as the admin-set-password event, so both land under "People" in the log.
      section: "people",
      entityType: "User",
      entityId: session.user.id,
      summary: "Changed their own password",
    },
  );

  return { ok: true };
}
