"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { isSafeResourceUrl, scopeOf, type ResourceScope } from "@/lib/resources";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * Resource writes - posting course material against a curriculum row, a batch or one class.
 *
 * ── Who may post what ───────────────────────────────────────────────────────────────────
 * A BATCH or SESSION resource is a delivery act: the coach or tutor who runs that cohort may
 * post it, as may Admin and anyone holding `batches.manage`. Same test as the register.
 *
 * A CURRICULUM resource is Admin-only, because its blast radius is every cohort that will ever
 * run that programme - including ones that do not exist yet. That is a decision about the
 * product, not about this Saturday's class.
 */

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const schema = z.object({
  title: z.string().trim().min(1, "Give the resource a name").max(200),
  description: z.string().trim().max(1000).optional(),
  kind: z.enum(["DOCUMENT", "VIDEO", "TEMPLATE", "TOOL", "LINK"]),
  url: z.string().trim().min(1, "Paste the link").max(2000),
  // Absent checkbox = unchecked = hidden. The form always renders it, so absence is a real "no".
  visibleToStudents: z.coerce.boolean().optional(),
});

type Scope = { scope: ResourceScope; id: string };

/** Admin, `batches.manage`, or the person who runs the cohort this resource hangs off. */
async function canManage(
  session: { role: string; user: { id: string }; capabilities: unknown },
  target: Scope,
): Promise<boolean> {
  if (session.role === "ADMIN") return true;
  // Curriculum material reaches every future cohort - that stays with the founder.
  if (target.scope === "curriculumItem") return false;
  if (hasCapability(session.role as never, (session.capabilities ?? null) as never, "batches.manage")) return true;

  const batchId =
    target.scope === "batch"
      ? target.id
      : (await prisma.classSession.findUnique({ where: { id: target.id }, select: { batchId: true } }))?.batchId;
  if (!batchId) return false;
  const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { tutorId: true } });
  return !!batch && batch.tutorId === session.user.id;
}

/** Where to re-render after a change. A session resource shows up on three different screens. */
async function revalidateFor(target: Scope): Promise<void> {
  revalidatePath("/classroom");
  revalidatePath("/coaching");
  revalidatePath("/dashboard");
  if (target.scope === "curriculumItem") {
    revalidatePath("/programs");
    return;
  }
  const batchId =
    target.scope === "batch"
      ? target.id
      : (await prisma.classSession.findUnique({ where: { id: target.id }, select: { batchId: true } }))?.batchId;
  if (batchId) revalidatePath(`/batches/${batchId}`);
}

export async function upsertResource(
  target: Scope,
  resourceId: string | null,
  form: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!(await canManage(session, target))) {
    return {
      ok: false,
      error:
        target.scope === "curriculumItem"
          ? "Curriculum material reaches every cohort - only the founder can change it."
          : "Not allowed",
    };
  }

  const raw = Object.fromEntries(form);
  for (const k of ["description"]) {
    if (typeof raw[k] === "string" && raw[k].trim() === "") delete raw[k];
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  /**
   * The link is validated, not sanitised. These are typed by staff and rendered as anchors in a
   * STUDENT's browser, so `javascript:` here is stored XSS against the people this app exists to
   * serve. http(s) only, and anything else is refused with a reason rather than quietly fixed.
   */
  if (!isSafeResourceUrl(d.url)) {
    return { ok: false, error: "That link must start with http:// or https://" };
  }

  const where =
    target.scope === "curriculumItem"
      ? { curriculumItemId: target.id }
      : target.scope === "batch"
        ? { batchId: target.id }
        : { sessionId: target.id };

  // Belt and braces with the CHECK constraint: one scope, always.
  if (!scopeOf(where)) return { ok: false, error: "A resource must belong to exactly one place" };

  const data = {
    title: d.title,
    description: d.description || null,
    kind: d.kind as never,
    url: d.url.trim(),
    // The form posts "on" when ticked and nothing when not; `z.coerce.boolean()` reads the
    // absence as false, which is the safe direction - a new resource is only visible if asked.
    visibleToStudents: !!d.visibleToStudents,
  };

  if (resourceId) {
    const prior = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: { curriculumItemId: true, batchId: true, sessionId: true },
    });
    if (!prior) return { ok: false, error: "Resource not found" };
    // Editing must not move a resource between scopes - that would dodge the permission check
    // the caller already passed for the scope it is IN.
    const priorScope = scopeOf(prior);
    if (priorScope !== target.scope) return { ok: false, error: "That resource belongs somewhere else" };
    await prisma.resource.update({ where: { id: resourceId }, data });
  } else {
    const last = await prisma.resource.findFirst({
      where,
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });
    await prisma.resource.create({
      data: { ...data, ...where, orderIndex: (last?.orderIndex ?? -1) + 1, createdById: session.user.id },
    });
  }

  await logActivity(session, {
    action: resourceId ? "resource.update" : "resource.create",
    section: target.scope === "curriculumItem" ? "programs" : "students",
    entityType: "Resource",
    entityId: resourceId ?? target.id,
    summary: `${resourceId ? "Updated" : "Added"} the resource "${d.title}"`,
    meta: { scope: target.scope, scopeId: target.id, kind: d.kind, visible: data.visibleToStudents },
  });

  await revalidateFor(target);
  return { ok: true };
}

export async function deleteResource(resourceId: string): Promise<ActionResult> {
  const session = await requireSession();
  const row = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { title: true, curriculumItemId: true, batchId: true, sessionId: true },
  });
  if (!row) return { ok: false, error: "Resource not found" };

  const scope = scopeOf(row);
  if (!scope) return { ok: false, error: "Resource not found" };
  const target: Scope = { scope, id: (row.curriculumItemId ?? row.batchId ?? row.sessionId)! };
  if (!(await canManage(session, target))) return { ok: false, error: "Not allowed" };

  await prisma.resource.delete({ where: { id: resourceId } });
  await logActivity(session, {
    action: "resource.delete",
    section: scope === "curriculumItem" ? "programs" : "students",
    entityType: "Resource",
    entityId: resourceId,
    summary: `Removed the resource "${row.title}"`,
    meta: { scope, scopeId: target.id },
  });
  await revalidateFor(target);
  return { ok: true };
}

/**
 * Show or hide a resource from students, without deleting it.
 *
 * The point of the flag: an exercise that gives away the answer is written before the class and
 * released after it. Deleting and re-adding would lose the link and the ordering.
 */
export async function setResourceVisibility(resourceId: string, visible: boolean): Promise<ActionResult> {
  const session = await requireSession();
  const row = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { title: true, curriculumItemId: true, batchId: true, sessionId: true },
  });
  if (!row) return { ok: false, error: "Resource not found" };
  const scope = scopeOf(row);
  if (!scope) return { ok: false, error: "Resource not found" };
  const target: Scope = { scope, id: (row.curriculumItemId ?? row.batchId ?? row.sessionId)! };
  if (!(await canManage(session, target))) return { ok: false, error: "Not allowed" };

  await prisma.resource.update({ where: { id: resourceId }, data: { visibleToStudents: visible } });
  await logActivity(session, {
    action: "resource.visibility",
    section: scope === "curriculumItem" ? "programs" : "students",
    entityType: "Resource",
    entityId: resourceId,
    summary: `${visible ? "Released" : "Hid"} the resource "${row.title}"`,
    meta: { scope, visible },
  });
  await revalidateFor(target);
  return { ok: true };
}
