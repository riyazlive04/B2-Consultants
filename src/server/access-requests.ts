"use server";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rule } from "@/lib/field-rules";
import { capabilityCheck, requireCapability } from "@/lib/rbac";
import { clientIpFrom, takeTokens, RATE_RULES } from "@/lib/rate-limit";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * "Request access" flow from the design file: a prospect teammate asks for a
 * seat on the login screen; the request lands in People → Users & access for
 * the Admin to approve (pre-fills the create-user form) or decline.
 *
 * Requests live in the AppSetting key/value store - a handful of rows for a
 * single-org tool doesn't warrant a table, and this keeps the schema untouched.
 */

const KEY = "accessRequests";
/**
 * How many pending requests the queue holds (issue B2).
 *
 * Raised from 20, and - more importantly - the overflow behaviour is inverted. It used to REFUSE
 * the newest request once the queue was full, which handed an unauthenticated stranger a
 * denial-of-onboarding: twenty junk rows and every genuine request after them was turned away
 * with "contact your admin directly", to an admin who had no idea why. It now sheds the OLDEST,
 * so a real person filing a request today always lands. See `submitAccessRequest`.
 *
 * The brake that actually bounds the flood is the rate limit, not this number.
 */
const MAX_PENDING = 40;

/**
 * A stable, non-reversible marker for "these requests came from the same place".
 *
 * Deliberately NOT the IP address. An admin triaging the queue needs to see that fourteen rows
 * share a source; they do not need - and should not be handed - the home IP of every stranger
 * who ever filled in the form. Twelve hex characters is plenty to group by and useless for
 * anything else.
 */
function sourceFingerprint(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`accessRequest:${ip}`).digest("hex").slice(0, 12);
}

export type AccessRequest = {
  id: string;
  name: string;
  email: string;
  /**
   * Widened to every app role, and it deliberately still INCLUDES "ADMIN" even though
   * `submitSchema` no longer accepts one. This is the shape of rows already sitting in the
   * queue: requests filed before ADMIN was removed are still there, and typing them as
   * un-representable would make the approval screen crash on exactly the rows an admin most
   * needs to see in order to decline them.
   *
   * New ADMIN requests cannot be created - see `submitSchema`.
   */
  role: "ADMIN" | "HEAD" | "USER" | "TUTOR" | "STUDENT" | "COACH";
  note: string;
  requestedAt: string; // ISO
  /**
   * Non-reversible marker for the source of the request - see `sourceFingerprint`. Optional
   * because rows filed before it existed do not have one, and a missing marker must read as
   * "unknown", never crash the approval screen.
   */
  source?: string | null;
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

/**
 * PUBLIC input, so this is the real gate - the login screen's character filters are UX only and a
 * crafted POST never runs them. `rule()` keeps the two definitions of "a name" / "an email" from
 * drifting apart; `note` keeps its own 500 cap (tighter than the shared text kind's 2000).
 */
const submitSchema = z.object({
  name: rule("name"),
  email: rule("email"),
  /**
   * THREE ROLES ARE NOT REQUESTABLE, AND THIS ENUM IS THE GATE. The login screen's role picker
   * is UX; a crafted POST never renders it. So every narrowing happens HERE as well as there,
   * or it has not happened.
   *
   * ADMIN - the original exclusion. Full finance, compliance and all-teams access was one HTTP
   * request away for anyone who found the endpoint, landing in the same approval queue as a
   * telecaller's where one mis-click grants it.
   *
   * HEAD - removed for the same reason one rung down (issue B3). A head coach holds Students,
   * Agreements, Onboarding, Attendance, Batches & Plans, Pipeline, Deals, Bookings, Reports and
   * Bonus & Commission: the second-widest grant in the app. A head coach is hired, not
   * self-served.
   *
   * STUDENT - removed because approving one is a guaranteed dead end (issue A3). A STUDENT user
   * with no `Student` row can reach only `personal` sections, and all three of those resolve the
   * signed-in user to a student record that does not exist. A student login is created FROM
   * their student record; that is why `/portal` offers no request form at all.
   *
   * Widening this enum again means first answering what the approved account would be able to
   * DO on the day it is created.
   */
  role: z.enum(["USER", "TUTOR", "COACH"]),
  note: z.string().trim().max(500).default(""),
});

/**
 * PUBLIC (called from the login screen, pre-auth). Always answers ok on valid input - whether
 * the email already has an account or a pending request is not revealed to an unauthenticated
 * caller.
 *
 * ── RATE LIMITED, AND IT HAD TO BE (issue B2) ───────────────────────────────────────────
 * This is the only unauthenticated WRITE in the app, and what it writes is the queue accounts
 * are approved from. With no brake, anyone who found the login page could file enough rows to
 * fill the pending cap - which refused every genuine request after it - and every one of those
 * rows is attacker-chosen text that the approval screen pre-fills a create-user form from.
 *
 * Two rules, all-or-nothing (see `takeTokens`): per-source, so one abuser is stopped, and
 * global, because a hundred sources each politely taking their allowance is the same attack
 * with more steps.
 *
 * The refusal message is deliberately the same shape as the old pending-cap one. It tells a
 * real person who tried twice by accident what to do, and tells an abuser nothing about which
 * of the two rules they hit.
 */
export async function submitAccessRequest(input: {
  name: string;
  email: string;
  role: string;
  note: string;
}): Promise<ActionResult> {
  const h = await Promise.resolve(headers());
  const ip = clientIpFrom(h);
  const verdict = takeTokens([
    { key: `accessRequest:ip:${ip}`, rule: RATE_RULES.accessRequestPerIp },
    { key: "accessRequest:global", rule: RATE_RULES.accessRequestGlobal },
  ]);
  if (!verdict.ok) {
    return {
      ok: false,
      error: "We've had a lot of requests just now - please try again later, or contact B2 Consultants directly.",
    };
  }

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
    queue.unshift({
      id: `rq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: d.name,
      email,
      role: d.role,
      note: d.note,
      requestedAt: new Date().toISOString(),
      source: sourceFingerprint(ip),
    });
    /**
     * SHED THE OLDEST, never refuse the newest.
     *
     * `unshift` puts the newest first, so truncating the tail drops the stalest row. An
     * unactioned request that has sat in this queue past forty others was not going to be
     * approved; a request filed thirty seconds ago by somebody waiting on a reply might be.
     * Getting this backwards is what made the cap a denial-of-onboarding.
     */
    await writeQueue(queue.slice(0, MAX_PENDING));
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

/** Drop any pending request for this email - called after the account is created. */
export async function consumeAccessRequest(email: string): Promise<void> {
  await requireCapability("users.manage");
  const queue = await readQueue();
  const next = queue.filter((r) => r.email.toLowerCase() !== email.toLowerCase());
  if (next.length !== queue.length) await writeQueue(next);
}
