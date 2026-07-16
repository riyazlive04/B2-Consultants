"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { slugify, type Block } from "@/lib/sites-types";
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
  await prisma.funnel.create({
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
  revalidatePath("/funnels");
  return { ok: true };
}

export async function renameFunnel(id: string, name: string): Promise<ActionResult> {
  await requireSection("funnels");
  if (!name.trim()) return { ok: false, error: "Funnel name is required" };
  await prisma.funnel.update({ where: { id }, data: { name: name.trim() } });
  revalidatePath("/funnels");
  revalidatePath(`/funnels/${id}`);
  return { ok: true };
}

export async function togglePublishFunnel(id: string): Promise<ActionResult> {
  await requireSection("funnels");
  const f = await prisma.funnel.findUnique({ where: { id }, select: { published: true, _count: { select: { steps: true } } } });
  if (!f) return { ok: false, error: "Funnel not found" };
  if (!f.published && f._count.steps === 0) return { ok: false, error: "Add at least one step before publishing" };
  await prisma.funnel.update({ where: { id }, data: { published: !f.published } });
  revalidatePath("/funnels");
  revalidatePath(`/funnels/${id}`);
  return { ok: true };
}

export async function deleteFunnel(id: string): Promise<ActionResult> {
  const { allowed, denied } = await capabilityCheck("pipeline.configure");
  if (!allowed) return denied;
  await prisma.funnel.delete({ where: { id } });
  revalidatePath("/funnels");
  return { ok: true };
}

// ─────────────────────────── Steps ───────────────────────────

export async function addStep(funnelId: string, name: string): Promise<ActionResult> {
  await requireSection("funnels");
  if (!name.trim()) return { ok: false, error: "Step name is required" };
  const slug = await uniqueStepSlug(funnelId, name);
  const max = await prisma.funnelStep.aggregate({ where: { funnelId }, _max: { position: true } });
  await prisma.funnelStep.create({
    data: { funnelId, name: name.trim(), slug, position: (max._max.position ?? -1) + 1, blocks: [] as unknown as Prisma.InputJsonValue },
  });
  revalidatePath(`/funnels/${funnelId}`);
  return { ok: true };
}

export async function renameStep(id: string, name: string): Promise<ActionResult> {
  await requireSection("funnels");
  if (!name.trim()) return { ok: false, error: "Step name is required" };
  const step = await prisma.funnelStep.findUnique({ where: { id }, select: { funnelId: true } });
  if (!step) return { ok: false, error: "Step not found" };
  await prisma.funnelStep.update({ where: { id }, data: { name: name.trim() } });
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}

export async function deleteStep(id: string): Promise<ActionResult> {
  await requireSection("funnels");
  const step = await prisma.funnelStep.findUnique({ where: { id }, select: { funnelId: true } });
  if (!step) return { ok: false, error: "Step not found" };
  const count = await prisma.funnelStep.count({ where: { funnelId: step.funnelId } });
  if (count <= 1) return { ok: false, error: "A funnel needs at least one step" };
  await prisma.funnelStep.delete({ where: { id } });
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}

export async function reorderSteps(funnelId: string, orderedIds: string[]): Promise<ActionResult> {
  await requireSection("funnels");
  await prisma.$transaction(orderedIds.map((id, i) => prisma.funnelStep.update({ where: { id }, data: { position: i } })));
  revalidatePath(`/funnels/${funnelId}`);
  return { ok: true };
}

export async function saveStepBlocks(
  stepId: string,
  payload: { blocks: Block[]; name?: string; seoTitle?: string; seoDescription?: string },
): Promise<ActionResult> {
  await requireSection("funnels");
  const step = await prisma.funnelStep.findUnique({ where: { id: stepId }, select: { funnelId: true } });
  if (!step) return { ok: false, error: "Step not found" };
  await prisma.funnelStep.update({
    where: { id: stepId },
    data: {
      blocks: payload.blocks as unknown as Prisma.InputJsonValue,
      ...(payload.name?.trim() ? { name: payload.name.trim() } : {}),
      seoTitle: payload.seoTitle?.trim() || null,
      seoDescription: payload.seoDescription?.trim() || null,
    },
  });
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}
