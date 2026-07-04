"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireAdmin, SECTIONS, type SectionKey } from "@/lib/rbac";
import type { ActionResult } from "./finance-actions";

/**
 * Admin user management (Ameen creates every account - public sign-up stays off).
 * Per-user feature access: overrides stored on User.sectionAccess, layered over
 * the role defaults in rbac.ts. Admins always have everything.
 */

// Local instance WITH sign-up enabled, used only inside admin-guarded actions.
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

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["ADMIN", "HEAD", "USER", "STUDENT"]),
});

function parseSectionAccess(form: FormData): Record<string, boolean> {
  const access: Record<string, boolean> = {};
  for (const s of SECTIONS) {
    access[s.key] = form.get(`section_${s.key}`) === "on";
  }
  return access;
}

export async function createUser(form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return { ok: false, error: "A user with this email already exists" };

  try {
    const res = await provisioningAuth.api.signUpEmail({
      body: { name: d.name, email: d.email, password: d.password },
    });
    await prisma.user.update({
      where: { id: res.user.id },
      data: {
        role: d.role,
        emailVerified: true,
        sectionAccess: d.role === "ADMIN" ? undefined : parseSectionAccess(form),
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create user" };
  }
  revalidatePath("/people");
  return { ok: true };
}

export async function updateUserAccess(userId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const role = z.enum(["ADMIN", "HEAD", "USER", "STUDENT"]).safeParse(form.get("role"));
  if (!role.success) return { ok: false, error: "Invalid role" };

  // Safety rails: Ameen can't demote himself, and the last Admin can't be demoted.
  if (userId === session.user.id && role.data !== "ADMIN") {
    return { ok: false, error: "You cannot remove your own Admin role" };
  }
  if (role.data !== "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN", id: { not: userId } } });
    if (admins === 0) return { ok: false, error: "At least one Admin must remain" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      role: role.data,
      sectionAccess: role.data === "ADMIN" ? Prisma.JsonNull : parseSectionAccess(form),
    },
  });
  // keep any linked team profile's dashboard role in sync
  await prisma.teamProfile.updateMany({ where: { userId }, data: { dashboardRole: role.data } });
  revalidatePath("/people");
  return { ok: true };
}

/** Clear overrides → the role defaults apply again. */
export async function resetUserAccess(userId: string): Promise<ActionResult> {
  await requireAdmin();
  await prisma.user.update({ where: { id: userId }, data: { sectionAccess: Prisma.JsonNull } });
  revalidatePath("/people");
  return { ok: true };
}

export async function setUserPassword(userId: string, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  try {
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(password);
    await ctx.internalAdapter.updatePassword(userId, hash);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update password" };
  }
  revalidatePath("/people");
  return { ok: true };
}

export async function listUsers() {
  await requireAdmin();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, sectionAccess: true, createdAt: true },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as "ADMIN" | "HEAD" | "USER" | "STUDENT",
    sectionAccess: (u.sectionAccess as Partial<Record<SectionKey, boolean>> | null) ?? null,
    createdAt: u.createdAt.toISOString(),
  }));
}
