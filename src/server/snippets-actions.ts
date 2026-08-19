"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import type { Block } from "@/lib/sites-types";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * The section library and page templates (one `SectionSnippet` model, two scopes).
 *
 * Writing is gated on `funnels` like the builder itself - anyone who can build a page can save a
 * piece of one. DELETING is gated on `sites.manage`, because the library is shared: removing a
 * section everyone reaches for is not the same kind of act as removing it from your own page.
 */

/** Cap on a stored snippet, in serialised bytes. A page template is a few hundred nodes of plain
 *  JSON; anything past this is a paste of something that does not belong in a library row. */
const MAX_BYTES = 512_000;

export async function saveSnippet(payload: {
  name: string;
  category?: string;
  scope: "SECTION" | "PAGE";
  blocks: Block[];
}): Promise<ActionResult & { id?: string }> {
  const session = await requireSection("funnels");
  const name = payload.name.trim();
  if (!name) return { ok: false, error: "Give it a name you'll recognise later" };
  if (!Array.isArray(payload.blocks) || payload.blocks.length === 0) {
    return { ok: false, error: "There's nothing selected to save" };
  }
  const serialised = JSON.stringify(payload.blocks);
  if (serialised.length > MAX_BYTES) return { ok: false, error: "That's too large to save as a snippet" };

  const row = await prisma.sectionSnippet.create({
    data: {
      name,
      category: payload.category?.trim() || null,
      scope: payload.scope,
      blocks: payload.blocks as unknown as Prisma.InputJsonValue,
      createdById: session.user.id,
    },
  });
  await logActivity(session, {
    action: "snippet.create",
    section: "funnels",
    entityType: "SectionSnippet",
    entityId: row.id,
    summary: `Saved "${name}" to the ${payload.scope === "PAGE" ? "page templates" : "section library"}`,
    meta: { scope: payload.scope, category: row.category, nodeCount: payload.blocks.length },
  });
  revalidatePath("/funnels", "layout");
  return { ok: true, id: row.id };
}

export async function renameSnippet(id: string, name: string, category?: string): Promise<ActionResult> {
  const session = await requireSection("funnels");
  if (!name.trim()) return { ok: false, error: "Give it a name you'll recognise later" };
  const row = await prisma.sectionSnippet.update({
    where: { id },
    data: { name: name.trim(), category: category?.trim() || null },
  });
  await logActivity(session, {
    action: "snippet.update",
    section: "funnels",
    entityType: "SectionSnippet",
    entityId: id,
    summary: `Renamed the saved section to "${row.name}"`,
  });
  revalidatePath("/funnels", "layout");
  return { ok: true };
}

export async function deleteSnippet(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;
  const row = await prisma.sectionSnippet.findUnique({ where: { id }, select: { name: true, builtIn: true, scope: true } });
  if (!row) return { ok: false, error: "That snippet no longer exists" };
  // The built-ins are the library's floor. Someone tidying up should not be able to leave the
  // next person with an empty picker and no way to get the starter sections back.
  if (row.builtIn) return { ok: false, error: "Built-in sections can't be deleted - save your own version instead" };

  await prisma.sectionSnippet.delete({ where: { id } });
  await logActivity(session, {
    action: "snippet.delete",
    section: "funnels",
    entityType: "SectionSnippet",
    entityId: id,
    summary: `Deleted "${row.name}" from the ${row.scope === "PAGE" ? "page templates" : "section library"}`,
  });
  revalidatePath("/funnels", "layout");
  return { ok: true };
}
