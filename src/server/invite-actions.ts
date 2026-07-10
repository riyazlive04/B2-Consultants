"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hashInviteToken } from "@/lib/invite-token";

/**
 * Redeeming an invite. PUBLIC by necessity — the invitee has no session yet — so the
 * token is the only credential and every failure mode is checked here:
 * unknown, already used, expired, or the account was suspended/deleted meanwhile.
 *
 * On success the invite is consumed and the person is signed straight in, so they
 * never touch the login screen with a password they just typed twice.
 */

export type AcceptInviteResult = { ok: true } | { ok: false; error: string };

const acceptSchema = z
  .object({
    token: z.string().min(10).max(200),
    password: z.string().min(8, "Password must be at least 8 characters").max(200),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    path: ["confirm"],
    message: "The two passwords don't match",
  });

/** What the invite page needs before it renders a form. Never reveals the email on failure. */
export async function inspectInvite(token: string): Promise<
  { ok: true; name: string; email: string } | { ok: false; reason: "invalid" | "used" | "expired" | "suspended" }
> {
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      acceptedAt: true,
      expiresAt: true,
      user: { select: { name: true, email: true, status: true } },
    },
  });
  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.acceptedAt) return { ok: false, reason: "used" };
  if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (invite.user.status === "SUSPENDED") return { ok: false, reason: "suspended" };
  return { ok: true, name: invite.user.name, email: invite.user.email };
}

export async function acceptInvite(form: FormData): Promise<AcceptInviteResult> {
  const parsed = acceptSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { token, password } = parsed.data;

  const tokenHash = hashInviteToken(token);
  const invite = await prisma.userInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      acceptedAt: true,
      expiresAt: true,
      user: { select: { email: true, status: true } },
    },
  });

  // Re-check everything: `inspectInvite` ran on a previous request and the world moves.
  if (!invite || invite.acceptedAt) return { ok: false, error: "This invite link is no longer valid." };
  if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, error: "This invite link has expired. Ask for a new one." };
  if (invite.user.status === "SUSPENDED") return { ok: false, error: "This account has been suspended." };

  try {
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(invite.userId, await ctx.password.hash(password));
  } catch {
    return { ok: false, error: "Could not set your password. Try again." };
  }

  // Burn the token BEFORE signing in. `updateMany` with the unused guard makes this a
  // compare-and-set: two tabs racing the same link, and only one of them redeems it.
  const burned = await prisma.userInvite.updateMany({
    where: { id: invite.id, acceptedAt: null },
    data: { acceptedAt: new Date() },
  });
  if (burned.count === 0) return { ok: false, error: "This invite link has already been used." };

  try {
    // nextCookies() writes the session cookie from inside this action.
    await auth.api.signInEmail({
      body: { email: invite.user.email, password },
      headers: await Promise.resolve(headers()),
    });
  } catch {
    // The password IS set — they can simply sign in normally.
    return { ok: false, error: "Password set. Please sign in with your new password." };
  }
  return { ok: true };
}
