"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireCapability } from "@/lib/rbac";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * "Request access" flow from the design file: a prospect teammate asks for a
 * seat on the login screen; the request lands in People → Users & access for
 * the Admin to approve (pre-fills the create-user form) or decline.
 *
 * Requests live in the AppSetting key/value store — a handful of rows for a
 * single-org tool doesn't warrant a table, and this keeps the schema untouched.
 */

const KEY = "accessRequests";
const MAX_PENDING = 20;

export type AccessRequest = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "HEAD" | "USER";
  note: string;
  requestedAt: string; // ISO
};

async function readQueue(): Promise<AccessRequest[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  return Array.isArray(row?.value) ? (row.value as AccessRequest[]) : [];
}

async function writeQueue(queue: AccessRequest[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: queue },
    update: { value: queue },
  });
}

const submitSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  role: z.enum(["ADMIN", "HEAD", "USER"]),
  note: z.string().trim().max(500).default(""),
});

/**
 * PUBLIC (called from the login screen, pre-auth). Always answers ok on valid
 * input — whether the email already has an account or a pending request is
 * not revealed to an unauthenticated caller.
 */
export async function submitAccessRequest(input: {
  name: string;
  email: string;
  role: string;
  note: string;
}): Promise<ActionResult> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter your name and a valid email address." };
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();

  const [queue, existingUser] = await Promise.all([
    readQueue(),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);
  const duplicate = queue.some((r) => r.email.toLowerCase() === email);

  if (!existingUser && !duplicate) {
    if (queue.length >= MAX_PENDING) {
      return { ok: false, error: "Too many pending requests — contact your admin directly." };
    }
    queue.unshift({
      id: `rq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: d.name,
      email,
      role: d.role,
      note: d.note,
      requestedAt: new Date().toISOString(),
    });
    await writeQueue(queue);
    revalidatePath("/people");
  }
  return { ok: true };
}

export async function listAccessRequests(): Promise<AccessRequest[]> {
  await requireCapability("users.manage");
  return readQueue();
}

export async function declineAccessRequest(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("users.manage");
  if (!allowed) return denied;
  const queue = await readQueue();
  const request = queue.find((r) => r.id === id);
  await writeQueue(queue.filter((r) => r.id !== id));
  if (request) {
    await logActivity(session, {
      action: "access.request.reject",
      section: "people",
      entityType: "AccessRequest",
      entityId: id,
      summary: `Declined ${request.name}'s access request`,
      meta: { email: request.email, role: request.role },
    });
  }
  revalidatePath("/people");
  return { ok: true };
}

/** Drop any pending request for this email — called after the account is created. */
export async function consumeAccessRequest(email: string): Promise<void> {
  await requireCapability("users.manage");
  const queue = await readQueue();
  const next = queue.filter((r) => r.email.toLowerCase() !== email.toLowerCase());
  if (next.length !== queue.length) await writeQueue(next);
}
