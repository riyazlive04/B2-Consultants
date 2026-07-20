"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { capabilityCheck, requireCapability, type AppSession } from "@/lib/rbac";
import { SECTION_CATALOGUE, type AppRole, type SectionKey } from "@/lib/sections";
import {
  CAPABILITIES,
  effectiveCapabilities,
  hasCapability,
  type CapabilityKey,
  type CapabilityOverrides,
  type UserStatus,
} from "@/lib/capabilities";
import { INVITE_TTL_DAYS, mintInviteToken, unguessablePlaceholderPassword } from "@/lib/invite-token";
import { rule } from "@/lib/field-rules";
import { consumeAccessRequest } from "./access-requests";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Team & access. Guarded by the `users.manage` capability rather than a bare Admin
 * check, so the founder can delegate seat management — but see `privilegeError`:
 * a delegate can never mint an Admin, edit an Admin, or hand out a capability they
 * don't hold themselves. Privilege can be delegated; it cannot be manufactured.
 *
 * Nobody's password is ever chosen by an Admin. Accounts are created parked on an
 * unguessable placeholder and the person sets their own via a single-use invite link.
 */

// Local instance WITH sign-up enabled, used only inside guarded actions.
const provisioningAuth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "USER", input: false },
    },
  },
});

const ROLES = ["ADMIN", "HEAD", "USER", "STUDENT", "TUTOR"] as const;
const roleSchema = z.enum(ROLES);

const inviteSchema = z.object({
  name: rule("name"),
  email: rule("email"),
  role: roleSchema,
});

export type InviteResult = { ok: true; inviteUrl: string; expiresInDays: number } | { ok: false; error: string };

// ───────────────────────────── form parsing ─────────────────────────────

/** Keyed off the full catalogue, not the currently-enabled sections: a section the
 *  founder switches back on later finds this user's answer already recorded. */
function parseSectionAccess(form: FormData): Record<string, boolean> {
  const access: Record<string, boolean> = {};
  for (const s of SECTION_CATALOGUE) {
    access[s.key] = form.get(`section_${s.key}`) === "on";
  }
  return access;
}

function parseCapabilities(form: FormData): CapabilityOverrides {
  const caps: Record<string, boolean> = {};
  for (const c of CAPABILITIES) {
    caps[c.key] = form.get(`cap_${c.key}`) === "on";
  }
  return caps as CapabilityOverrides;
}

/** Admins hold everything implicitly, so storing overrides for them would only ever lie. */
const overridesFor = (role: AppRole, form: FormData) =>
  role === "ADMIN"
    ? { sectionAccess: Prisma.JsonNull, capabilities: Prisma.JsonNull }
    : { sectionAccess: parseSectionAccess(form), capabilities: parseCapabilities(form) as Prisma.InputJsonValue };

// ───────────────────────────── privilege rails ─────────────────────────────

type TargetUser = { id: string; role: AppRole; capabilities: Prisma.JsonValue };

/**
 * What a non-Admin holder of `users.manage` may NOT do. Without these rules the
 * capability is a back door to Admin: edit your own row, grant yourself every module
 * and capability, promote yourself. Each line below closes one of those doors.
 *
 * The last rule tests GRANTING, not merely holding: a delegate editing someone who
 * already has "Record income & expenses" must be able to save the form without
 * either stripping that capability or being refused for it. Only a false→true
 * transition is an escalation.
 */
function privilegeError(
  actor: AppSession,
  target: TargetUser | null,
  nextRole: AppRole,
  nextCaps: CapabilityOverrides,
): string | null {
  if (actor.role === "ADMIN") return null;
  if (target?.id === actor.user.id) return "You cannot edit your own access — ask an Admin.";
  if (target?.role === "ADMIN") return "Only an Admin can edit another Admin.";
  if (nextRole === "ADMIN") return "Only an Admin can grant the Admin role.";

  const held = target
    ? effectiveCapabilities(target.role, target.capabilities as CapabilityOverrides | null)
    : new Set<CapabilityKey>();

  for (const c of CAPABILITIES) {
    const granting = nextCaps[c.key] === true && !held.has(c.key);
    if (granting && !hasCapability(actor.role, actor.capabilities, c.key)) {
      return `You can only grant capabilities you hold yourself — you don't have "${c.name}".`;
    }
  }
  return null;
}

/** The founder must never be able to lock themselves — or the last Admin — out. */
async function lastAdminError(userId: string, nextRole: AppRole | null): Promise<string | null> {
  if (nextRole === "ADMIN") return null;
  const others = await prisma.user.count({
    where: { role: "ADMIN", status: "ACTIVE", id: { not: userId } },
  });
  return others === 0 ? "At least one active Admin must remain." : null;
}

// ───────────────────────────── invite ─────────────────────────────

/** Absolute URL for the invite link, from the request the Admin is making right now. */
async function originFromRequest(): Promise<string> {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/$/, "");
  const h = await Promise.resolve(headers());
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function issueInvite(userId: string, createdById: string): Promise<string> {
  const { token, tokenHash, expiresAt } = mintInviteToken();
  // One invite per user: re-inviting replaces the row, which instantly kills any link
  // already in circulation.
  await prisma.userInvite.upsert({
    where: { userId },
    create: { userId, tokenHash, expiresAt, createdById },
    update: { tokenHash, expiresAt, createdById, acceptedAt: null },
  });
  return `${await originFromRequest()}/invite/${token}`;
}

export async function inviteUser(form: FormData): Promise<InviteResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;

  const parsed = inviteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  const email = d.email.toLowerCase();

  const caps = d.role === "ADMIN" ? {} : parseCapabilities(form);
  const rail = privilegeError(session, null, d.role, caps);
  if (rail) return { ok: false, error: rail };

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return { ok: false, error: "A user with this email already exists" };
  }

  let userId: string;
  try {
    // Parked on a random password nobody has ever seen; the invite link replaces it.
    const res = await provisioningAuth.api.signUpEmail({
      body: { name: d.name, email, password: unguessablePlaceholderPassword() },
    });
    userId = res.user.id;
    await prisma.user.update({
      where: { id: userId },
      data: { role: d.role, emailVerified: true, ...overridesFor(d.role, form) },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create user" };
  }

  const inviteUrl = await issueInvite(userId, session.user.id);
  await consumeAccessRequest(email); // clears a matching "request access" row, if any
  // WHO was invited to WHAT, never the link: the token is a live credential and the
  // founder's activity screen outlives the invite that minted it.
  await logActivity(session, {
    action: "user.invite",
    section: "people",
    entityType: "User",
    entityId: userId,
    summary: `Invited ${d.name} (${email}) as ${d.role}`,
    meta: {
      email,
      role: d.role,
      sectionAccess: d.role === "ADMIN" ? null : parseSectionAccess(form),
      capabilities: d.role === "ADMIN" ? null : caps,
    },
  });
  revalidatePath("/people");
  return { ok: true, inviteUrl, expiresInDays: INVITE_TTL_DAYS };
}

/** Mint a fresh link — the old one stops working immediately. */
export async function resendInvite(userId: string): Promise<InviteResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, capabilities: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists" };
  const rail = privilegeError(session, target, target.role, {});
  if (rail) return { ok: false, error: rail };

  const inviteUrl = await issueInvite(userId, session.user.id);
  await logActivity(session, {
    action: "user.invite",
    section: "people",
    entityType: "User",
    entityId: userId,
    summary: `Re-issued the invite link for ${target.name} — any earlier link stopped working`,
    meta: { email: target.email, role: target.role, resend: true },
  });
  revalidatePath("/people");
  return { ok: true, inviteUrl, expiresInDays: INVITE_TTL_DAYS };
}

// ───────────────────────────── access ─────────────────────────────

export async function updateUserAccess(userId: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;

  const role = roleSchema.safeParse(form.get("role"));
  if (!role.success) return { ok: false, error: "Invalid role" };
  const name = rule("name").safeParse(form.get("name"));
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message ?? "Name is required" };

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, sectionAccess: true, capabilities: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists" };

  const caps = role.data === "ADMIN" ? {} : parseCapabilities(form);
  const rail = privilegeError(session, target, role.data, caps);
  if (rail) return { ok: false, error: rail };

  // Safety rails: nobody demotes themselves, and the last Admin can't be demoted.
  if (userId === session.user.id && role.data !== "ADMIN" && session.role === "ADMIN") {
    return { ok: false, error: "You cannot remove your own Admin role" };
  }
  if (target.role === "ADMIN" && role.data !== "ADMIN") {
    const err = await lastAdminError(userId, role.data);
    if (err) return { ok: false, error: err };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { name: name.data, role: role.data, ...overridesFor(role.data, form) },
  });
  // keep any linked team profile's dashboard role in sync
  await prisma.teamProfile.updateMany({ where: { userId }, data: { dashboardRole: role.data } });

  // Diffed against the plain values rather than `overridesFor`'s Prisma.JsonNull sentinel,
  // which carries no meaning outside a write.
  const diff = diffFields<Record<string, unknown>>(
    { name: target.name, role: target.role, sectionAccess: target.sectionAccess, capabilities: target.capabilities },
    {
      name: name.data,
      role: role.data,
      sectionAccess: role.data === "ADMIN" ? null : parseSectionAccess(form),
      capabilities: role.data === "ADMIN" ? null : caps,
    },
  );
  if (diff.changed.length) {
    await logActivity(session, {
      action: "user.access.update",
      section: "people",
      entityType: "User",
      entityId: userId,
      summary: `Updated ${target.name}'s access — changed ${diff.changed.join(", ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/people");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Clear overrides → the role defaults apply again, for both modules and capabilities. */
export async function resetUserAccess(userId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, sectionAccess: true, capabilities: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists" };
  const rail = privilegeError(session, target, target.role, {});
  if (rail) return { ok: false, error: rail };

  await prisma.user.update({
    where: { id: userId },
    data: { sectionAccess: Prisma.JsonNull, capabilities: Prisma.JsonNull },
  });
  const diff = diffFields<Record<string, unknown>>(
    { sectionAccess: target.sectionAccess, capabilities: target.capabilities },
    { sectionAccess: null, capabilities: null },
  );
  if (diff.changed.length) {
    await logActivity(session, {
      action: "user.access.update",
      section: "people",
      entityType: "User",
      entityId: userId,
      summary: `Reset ${target.name}'s access to the ${target.role} defaults`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/people");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ───────────────────────────── lifecycle ─────────────────────────────

export async function suspendUser(userId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;
  if (userId === session.user.id) return { ok: false, error: "You cannot suspend your own account" };

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, capabilities: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists" };
  const rail = privilegeError(session, target, target.role, {});
  if (rail) return { ok: false, error: rail };
  const err = await lastAdminError(userId, null);
  if (target.role === "ADMIN" && err) return { ok: false, error: err };

  // Suspend and evict in one transaction: they are logged out before the button settles.
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  await logActivity(session, {
    action: "user.suspend",
    section: "people",
    entityType: "User",
    entityId: userId,
    summary: `Suspended ${target.name}`,
    meta: { role: target.role },
  });
  revalidatePath("/people");
  return { ok: true };
}

export async function reactivateUser(userId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, capabilities: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists" };
  const rail = privilegeError(session, target, target.role, {});
  if (rail) return { ok: false, error: rail };

  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  await logActivity(session, {
    action: "user.reinstate",
    section: "people",
    entityType: "User",
    entityId: userId,
    summary: `Reinstated ${target.name}`,
    meta: { role: target.role },
  });
  revalidatePath("/people");
  return { ok: true };
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;
  if (userId === session.user.id) return { ok: false, error: "You cannot delete your own account" };

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, capabilities: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists" };
  const rail = privilegeError(session, target, target.role, {});
  if (rail) return { ok: false, error: rail };
  if (target.role === "ADMIN") {
    const err = await lastAdminError(userId, null);
    if (err) return { ok: false, error: err };
  }

  // Sessions, accounts and the invite cascade. The team profile and student record
  // survive with a null userId — their history is not this person's login.
  await prisma.user.delete({ where: { id: userId } });
  await logActivity(session, {
    action: "user.delete",
    section: "people",
    entityType: "User",
    entityId: userId,
    summary: `Deleted ${target.name}'s account (${target.email})`,
    meta: { email: target.email, role: target.role },
  });
  revalidatePath("/people");
  return { ok: true };
}

/** Admin fallback for someone who can't use their invite link. */
export async function setUserPassword(userId: string, form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, capabilities: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists" };
  const rail = privilegeError(session, target, target.role, {});
  if (rail) return { ok: false, error: rail };

  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  try {
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(password);
    await ctx.internalAdapter.updatePassword(userId, hash);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update password" };
  }
  // That it happened and who did it — never the password or its hash.
  await logActivity(session, {
    action: "user.password.update",
    section: "people",
    entityType: "User",
    entityId: userId,
    summary: `Set a new password for ${target.name}`,
    meta: { role: target.role },
  });
  revalidatePath("/people");
  return { ok: true };
}

// ───────────────────────────── read ─────────────────────────────

export type ListedUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  status: UserStatus;
  sectionAccess: Partial<Record<SectionKey, boolean>> | null;
  capabilities: CapabilityOverrides | null;
  createdAt: string;
  /** pending = invited but the link is unused and unexpired */
  invite: { pending: boolean; expired: boolean } | null;
};

export async function listUsers(): Promise<ListedUser[]> {
  await requireCapability("users.manage");
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, email: true, role: true, status: true,
      sectionAccess: true, capabilities: true, createdAt: true,
      invite: { select: { acceptedAt: true, expiresAt: true } },
    },
  });
  const now = Date.now();
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as AppRole,
    status: u.status as UserStatus,
    sectionAccess: (u.sectionAccess as Partial<Record<SectionKey, boolean>> | null) ?? null,
    capabilities: (u.capabilities as CapabilityOverrides | null) ?? null,
    createdAt: u.createdAt.toISOString(),
    invite: u.invite
      ? {
          pending: u.invite.acceptedAt === null && u.invite.expiresAt.getTime() > now,
          expired: u.invite.acceptedAt === null && u.invite.expiresAt.getTime() <= now,
        }
      : null,
  }));
}

