"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import { slugify, type Block } from "@/lib/sites-types";
import { withFreshIds } from "@/lib/page-tree";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/** Funnels / landing pages (Synamate "Funnels"). Admin CRUD gated to `funnels`; delete needs the
 *  sites.manage capability. Public rendering lives in the /p/* routes. */

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
  const f = await prisma.funnel.findUnique({ where: { id }, select: { name: true, published: true } });
  if (!f) return { ok: false, error: "Funnel not found" };
  // Controls only. A funnel whose single "step" is an A/B variant of a step that no longer exists
  // cannot happen (the FK cascades), but a count that included variants would let a funnel
  // publish on the strength of pages no visitor can navigate to.
  const stepCount = await prisma.funnelStep.count({ where: { funnelId: id, abTestOf: null } });
  if (!f.published && stepCount === 0) return { ok: false, error: "Add at least one step before publishing" };
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
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
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

/**
 * Add a step, optionally from a page template.
 *
 * `templateId` names a `SectionSnippet` with scope PAGE. Its blocks are copied, never referenced:
 * a template is a starting point, and a step that stayed linked to one would change under the
 * author's feet the next time somebody edited the template.
 */
export async function addStep(funnelId: string, name: string, templateId?: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  if (!name.trim()) return { ok: false, error: "Step name is required" };

  let blocks: Block[] = [];
  if (templateId) {
    const tpl = await prisma.sectionSnippet.findUnique({ where: { id: templateId }, select: { blocks: true, scope: true, name: true } });
    if (!tpl) return { ok: false, error: "That template no longer exists" };
    blocks = withFreshIds((tpl.blocks as Block[]) ?? []);
  }

  const slug = await uniqueStepSlug(funnelId, name);
  const max = await prisma.funnelStep.aggregate({ where: { funnelId }, _max: { position: true } });
  const row = await prisma.funnelStep.create({
    data: { funnelId, name: name.trim(), slug, position: (max._max.position ?? -1) + 1, blocks: blocks as unknown as Prisma.InputJsonValue },
  });
  const funnel = await prisma.funnel.findUnique({ where: { id: funnelId }, select: { name: true } });
  await logActivity(session, {
    action: "funnel.step.create",
    section: "funnels",
    entityType: "FunnelStep",
    entityId: row.id,
    summary: `Added the step "${name.trim()}" to the funnel "${funnel?.name ?? ""}"`,
    meta: { funnelId, slug, position: row.position, templateId: templateId ?? null, blockCount: blocks.length },
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
  const step = await prisma.funnelStep.findUnique({
    where: { id },
    select: { funnelId: true, name: true, abTestOf: true, _count: { select: { abVariants: true } }, funnel: { select: { name: true } } },
  });
  if (!step) return { ok: false, error: "Step not found" };
  // Controls only: deleting the last real step while two A/B variants of it exist would leave a
  // published funnel with nothing a visitor can reach. (The variants go with it — the FK
  // cascades — which is also why deleting a control says so before it happens, in the UI.)
  if (!step.abTestOf) {
    const count = await prisma.funnelStep.count({ where: { funnelId: step.funnelId, abTestOf: null } });
    if (count <= 1) return { ok: false, error: "A funnel needs at least one step" };
  }
  await prisma.funnelStep.delete({ where: { id } });
  await logActivity(session, {
    action: step.abTestOf ? "funnel.variant.delete" : "funnel.step.delete",
    section: "funnels",
    entityType: "FunnelStep",
    entityId: id,
    summary: step.abTestOf
      ? `Deleted the A/B variant "${step.name}" from the funnel "${step.funnel.name}"`
      : `Deleted the step "${step.name}" from the funnel "${step.funnel.name}"`,
    meta: { funnelId: step.funnelId, variantsRemoved: step._count.abVariants },
  });
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}

export async function reorderSteps(funnelId: string, orderedIds: string[]): Promise<ActionResult> {
  const session = await requireSection("funnels");
  await prisma.$transaction(
    orderedIds.flatMap((id, i) => [
      prisma.funnelStep.update({ where: { id }, data: { position: i } }),
      // Variants ride along with the step they test. They are never in `orderedIds` (the rail
      // does not list them), so without this they would keep the position their control had
      // before the move and the two would drift apart for no visible reason.
      prisma.funnelStep.updateMany({ where: { abTestOf: id }, data: { position: i } }),
    ]),
  );
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

// ─────────────────────────── Global header & footer ───────────────────────────

/**
 * Save the bands that wrap every step of a funnel.
 *
 * Held on the funnel rather than copied into each step: the header is a logo and a phone number,
 * and a four-step funnel that stores four copies of them is a four-step funnel where one of them
 * is out of date. Saved through the same autosaving editor as a page, hence the same shape.
 *
 * `null` clears the slot back to "this funnel has no header", which is NOT what an empty array
 * means — an empty header is a deliberate state someone is part-way through building.
 */
export async function saveFunnelChrome(
  funnelId: string,
  slot: "header" | "footer",
  blocks: Block[] | null,
): Promise<ActionResult> {
  const session = await requireSection("funnels");
  const f = await prisma.funnel.findUnique({ where: { id: funnelId }, select: { name: true, headerBlocks: true, footerBlocks: true } });
  if (!f) return { ok: false, error: "Funnel not found" };

  const field = slot === "header" ? "headerBlocks" : "footerBlocks";
  const before = slot === "header" ? f.headerBlocks : f.footerBlocks;
  // Prisma distinguishes SQL NULL from JSON null on a Json? column; `DbNull` is the one that
  // clears the column. Writing `null` here would store the JSON literal `null`, which reads back
  // as a value and would make "no header" indistinguishable from "a header that is null".
  const value = blocks === null ? Prisma.DbNull : (blocks as unknown as Prisma.InputJsonValue);
  await prisma.funnel.update({ where: { id: funnelId }, data: { [field]: value } });

  if (JSON.stringify(before ?? null) !== JSON.stringify(blocks)) {
    await logActivity(session, {
      action: "funnel.chrome.update",
      section: "funnels",
      entityType: "Funnel",
      entityId: funnelId,
      summary: `Edited the global ${slot} of the funnel "${f.name}"`,
      meta: { slot, blockCount: blocks?.length ?? 0, cleared: blocks === null },
    });
  }
  revalidatePath(`/funnels/${funnelId}`);
  return { ok: true };
}

// ─────────────────────────── A/B split ───────────────────────────

/**
 * Create a variant of a step: a copy of the page, tied to the original, sharing its traffic.
 *
 * Seeded with a COPY of the control's blocks rather than an empty page. A split test is almost
 * always "the same page with one thing changed", and starting from blank means the first thing
 * anyone does is rebuild the control by hand — introducing differences they did not intend to
 * test. Fresh node ids throughout, so the two pages cannot share styling rules.
 */
export async function createVariant(stepId: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  const control = await prisma.funnelStep.findUnique({
    where: { id: stepId },
    select: {
      funnelId: true, name: true, slug: true, position: true, blocks: true,
      seoTitle: true, seoDescription: true, abTestOf: true,
      funnel: { select: { name: true } }, _count: { select: { abVariants: true } },
    },
  });
  if (!control) return { ok: false, error: "Step not found" };
  // One level only. A variant of a variant has no coherent meaning — which weight would it be
  // measured against? — and the picker in lib/ab.ts deliberately reads a flat list.
  if (control.abTestOf) return { ok: false, error: "You can't split-test a variant. Add another variant of the original step instead." };
  if (control._count.abVariants >= 5) return { ok: false, error: "Five variants is the limit — split traffic any thinner and neither arm reaches a usable sample" };

  // B, C, D… — the control is A. Suffixed on the control's slug so the pair is legible in the
  // database and in the activity feed, even though the variant's slug is never an address.
  const letter = String.fromCharCode(66 + control._count.abVariants);
  const slug = await uniqueStepSlug(control.funnelId, `${control.slug}-${letter.toLowerCase()}`);
  const row = await prisma.funnelStep.create({
    data: {
      funnelId: control.funnelId,
      abTestOf: stepId,
      name: `${control.name} — ${letter}`,
      slug,
      // Shares the control's position: it occupies the same slot in the funnel, and any other
      // value would make it sort into a gap between two real steps.
      position: control.position,
      blocks: withFreshIds((control.blocks as Block[]) ?? []) as unknown as Prisma.InputJsonValue,
      seoTitle: control.seoTitle,
      seoDescription: control.seoDescription,
      abWeight: 50,
    },
  });
  await logActivity(session, {
    action: "funnel.variant.create",
    section: "funnels",
    entityType: "FunnelStep",
    entityId: row.id,
    summary: `Started an A/B test on "${control.name}" in the funnel "${control.funnel.name}"`,
    meta: { funnelId: control.funnelId, controlId: stepId, variant: letter },
  });
  revalidatePath(`/funnels/${control.funnelId}`);
  return { ok: true };
}

/** Set the relative traffic share of a step or one of its variants. 0 pauses an arm. */
export async function setStepWeight(stepId: string, weight: number): Promise<ActionResult> {
  const session = await requireSection("funnels");
  if (!Number.isFinite(weight) || weight < 0 || weight > 1000) return { ok: false, error: "Weight must be between 0 and 1000" };
  const step = await prisma.funnelStep.findUnique({
    where: { id: stepId },
    select: { funnelId: true, name: true, abWeight: true, funnel: { select: { name: true } } },
  });
  if (!step) return { ok: false, error: "Step not found" };
  const next = Math.round(weight);
  if (next === step.abWeight) return { ok: true };

  await prisma.funnelStep.update({ where: { id: stepId }, data: { abWeight: next } });
  await logActivity(session, {
    action: "funnel.variant.update",
    section: "funnels",
    entityType: "FunnelStep",
    entityId: stepId,
    summary: `Set "${step.name}" to ${next}% weight in the funnel "${step.funnel.name}"`,
    meta: { funnelId: step.funnelId, before: step.abWeight, after: next },
  });
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}

/** Reset an arm's view counter — how you restart a test after changing what it is testing. */
export async function resetVariantViews(stepId: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  const step = await prisma.funnelStep.findUnique({
    where: { id: stepId },
    select: { funnelId: true, name: true, views: true, abTestOf: true, funnel: { select: { name: true } } },
  });
  if (!step) return { ok: false, error: "Step not found" };

  // Every arm of the experiment at once. Zeroing one side alone produces a comparison between a
  // fresh counter and a stale one, which reads as a landslide that never happened.
  const controlId = step.abTestOf ?? stepId;
  await prisma.funnelStep.updateMany({
    where: { OR: [{ id: controlId }, { abTestOf: controlId }] },
    data: { views: 0 },
  });
  await logActivity(session, {
    action: "funnel.variant.update",
    section: "funnels",
    entityType: "FunnelStep",
    entityId: controlId,
    summary: `Reset the A/B view counts on "${step.name}" in the funnel "${step.funnel.name}"`,
    meta: { funnelId: step.funnelId },
  });
  revalidatePath(`/funnels/${step.funnelId}`);
  return { ok: true };
}
