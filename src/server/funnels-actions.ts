"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { slugify, type Block } from "@/lib/sites-types";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/** Funnels / landing pages (Synamate "Funnels"). Admin CRUD gated to `funnels`; delete needs the
 *  pipeline.configure capability. Public rendering lives in the /p/* routes. */

async function uniqueFunnelSlug(base: string, ignoreId?: string): Promise<string> {
  const root = slugify(base);
  let slug = root;
  let n = 1;
  for (;;) {
    const hit = await prisma.funnel.findUnique({ where: { slug } });
    if (!hit || hit.id === ignoreId) return slug;
    slug = `${root}-${++n}`;
  }
}

async function uniqueStepSlug(funnelId: string, base: string, ignoreId?: string): Promise<string> {
  const root = slugify(base);
  let slug = root;
  let n = 1;
  for (;;) {
    const hit = await prisma.funnelStep.findUnique({ where: { funnelId_slug: { funnelId, slug } } });
    if (!hit || hit.id === ignoreId) return slug;
    slug = `${root}-${++n}`;
  }
}

export async function createFunnel(form: FormData): Promise<ActionResult> {
  const session = await requireSection("funnels");
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Funnel name is required" };
  const slug = await uniqueFunnelSlug(name);
  const row = await prisma.funnel.create({
    data: {
      name,
      slug,
      createdById: session.user.id,
      steps: {
        create: {
          name: "Landing",
          slug: "landing",
          position: 0,
          blocks: [
            { id: "b1", type: "heading", text: name, align: "center" },
            { id: "b2", type: "text", text: "Tell your story here, then capture the lead.", align: "center" },
          ] as unknown as Prisma.InputJsonValue,
        },
      },
    },
  });
  await logActivity(session, {
    action: "funnel.create",
    section: "funnels",
    entityType: "Funnel",
    entityId: row.id,
    summary: `Created the funnel "${name}"`,
    meta: { slug },
  });
  revalidatePath("/funnels");
  return { ok: true };
}

export async function renameFunnel(id: string, name: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  if (!name.trim()) return { ok: false, error: "Funnel name is required" };
  const before = await prisma.funnel.findUnique({ where: { id }, select: { name: true } });
  await prisma.funnel.update({ where: { id }, data: { name: name.trim() } });
  const d = diffFields({ name: before?.name ?? "" }, { name: name.trim() });
  if (d.changed.length) {
    await logActivity(session, {
      action: "funnel.update",
      section: "funnels",
      entityType: "Funnel",
      entityId: id,
      summary: `Renamed the funnel "${before?.name ?? ""}" to "${name.trim()}"`,
      meta: { changed: d.changed, before: d.before, after: d.after },
    });
  }
  revalidatePath("/funnels");
  revalidatePath(`/funnels/${id}`);
  return { ok: true };
}

export async function togglePublishFunnel(id: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  const f = await prisma.funnel.findUnique({ where: { id }, select: { name: true, published: true, _count: { select: { steps: true } } } });
  if (!f) return { ok: false, error: "Funnel not found" };
  if (!f.published && f._count.steps === 0) return { ok: false, error: "Add at least one step before publishing" };
  await prisma.funnel.update({ where: { id }, data: { published: !f.published } });
  await logActivity(session, {
    action: f.published ? "funnel.unpublish" : "funnel.publish",
    section: "funnels",
    entityType: "Funnel",
    entityId: id,
    summary: `${f.published ? "Unpublished" : "Published"} the funnel "${f.name}"`,
  });
  revalidatePath("/funnels");
  revalidatePath(`/funnels/${id}`);
  return { ok: true };
}

export async function deleteFunnel(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  const row = await prisma.funnel.delete({ where: { id } });
  await logActivity(session, {
    action: "funnel.delete",
    section: "funnels",
    entityType: "Funnel",
    entityId: id,
    summary: `Deleted the funnel "${row.name}"`,
    meta: { slug: row.slug },
  });
  revalidatePath("/funnels");
  return { ok: true };
}

// ─────────────────────────── Steps ───────────────────────────

export async function addStep(funnelId: string, name: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  if (!name.trim()) return { ok: false, error: "Step name is required" };
  const slug = await uniqueStepSlug(funnelId, name);
  const max = await prisma.funnelStep.aggregate({ where: { funnelId }, _max: { position: true } });
  const row = await prisma.funnelStep.create({
    data: { funnelId, name: name.trim(), slug, position: (max._max.position ?? -1) + 1, blocks: [] as unknown as Prisma.InputJsonValue },
  });
  const funnel = await prisma.funnel.findUnique({ where: { id: funnelId }, select: { name: true } });
  await logActivity(session, {
    action: "funnel.step.create",
    section: "funnels",
    entityType: "FunnelStep",
    entityId: row.id,
    summary: `Added the step "${name.trim()}" to the funnel "${funnel?.name ?? ""}"`,
    meta: { funnelId, slug, position: row.position },
  });
  revalidatePath(`/funnels/${funnelId}`);
  return { ok: true };
}

export async function renameStep(id: string, name: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  if (!name.trim()) return { ok: false, error: "Step name is required" };
  const step = await prisma.funnelStep.findUnique({ where: { id }, select: { funnelId: true, name: true, funnel: { select: { name: true } } } });
  if (!step) return { ok: false, error: "Step not found" };
  await prisma.funnelStep.update({ where: { id }, data: { name: name.trim() } });
  const d = diffFields({ name: step.name }, { name: name.trim() });
  if (d.changed.length) {
    await logActivity(session, {
      action: "funnel.step.update",
      section: "funnels",
      entityType: "FunnelStep",
      entityId: id,
      summary: `Renamed the step "${step.name}" to "${name.trim()}" in the funnel "${step.funnel.name}"`,
      meta: { changed: d.changed, before: d.before, after: d.after, funnelId: step.funnelId },
    });
  }
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}

export async function deleteStep(id: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  const step = await prisma.funnelStep.findUnique({ where: { id }, select: { funnelId: true, name: true, funnel: { select: { name: true } } } });
  if (!step) return { ok: false, error: "Step not found" };
  const count = await prisma.funnelStep.count({ where: { funnelId: step.funnelId } });
  if (count <= 1) return { ok: false, error: "A funnel needs at least one step" };
  await prisma.funnelStep.delete({ where: { id } });
  await logActivity(session, {
    action: "funnel.step.delete",
    section: "funnels",
    entityType: "FunnelStep",
    entityId: id,
    summary: `Deleted the step "${step.name}" from the funnel "${step.funnel.name}"`,
    meta: { funnelId: step.funnelId },
  });
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}

export async function reorderSteps(funnelId: string, orderedIds: string[]): Promise<ActionResult> {
  const session = await requireSection("funnels");
  await prisma.$transaction(orderedIds.map((id, i) => prisma.funnelStep.update({ where: { id }, data: { position: i } })));
  const funnel = await prisma.funnel.findUnique({ where: { id: funnelId }, select: { name: true } });
  await logActivity(session, {
    action: "funnel.step.reorder",
    section: "funnels",
    entityType: "Funnel",
    entityId: funnelId,
    summary: `Reordered the ${orderedIds.length} steps in the funnel "${funnel?.name ?? ""}"`,
    meta: { orderedIds },
  });
  revalidatePath(`/funnels/${funnelId}`);
  return { ok: true };
}

export async function saveStepBlocks(
  stepId: string,
  payload: { blocks: Block[]; name?: string; seoTitle?: string; seoDescription?: string },
): Promise<ActionResult> {
  const session = await requireSection("funnels");
  const step = await prisma.funnelStep.findUnique({
    where: { id: stepId },
    select: { funnelId: true, name: true, blocks: true, seoTitle: true, seoDescription: true, funnel: { select: { name: true } } },
  });
  if (!step) return { ok: false, error: "Step not found" };
  const name = payload.name?.trim() ? payload.name.trim() : step.name;
  await prisma.funnelStep.update({
    where: { id: stepId },
    data: {
      blocks: payload.blocks as unknown as Prisma.InputJsonValue,
      ...(payload.name?.trim() ? { name: payload.name.trim() } : {}),
      seoTitle: payload.seoTitle?.trim() || null,
      seoDescription: payload.seoDescription?.trim() || null,
    },
  });
  // The page builder saves the whole block tree on every save, so `blocks` is compared but never
  // logged — a page of copy in `meta` would bury the feed and tell the founder nothing.
  const d = diffFields(
    { name: step.name, seoTitle: step.seoTitle, seoDescription: step.seoDescription },
    { name, seoTitle: payload.seoTitle?.trim() || null, seoDescription: payload.seoDescription?.trim() || null },
  );
  const changed = [
    ...d.changed,
    ...(JSON.stringify(step.blocks ?? null) !== JSON.stringify(payload.blocks) ? ["blocks"] : []),
  ];
  if (changed.length) {
    await logActivity(session, {
      action: "funnel.step.update",
      section: "funnels",
      entityType: "FunnelStep",
      entityId: stepId,
      summary: `Edited the step "${name}" in the funnel "${step.funnel.name}"`,
      meta: { changed, before: d.before, after: d.after, funnelId: step.funnelId, blockCount: payload.blocks.length },
    });
  }
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}
