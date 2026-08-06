"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { capabilityCheck, requireSection } from "@/lib/rbac";
import { deleteObject, storageConfig } from "@/lib/supabase-storage";
import { logActivity } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * The media library. Uploading lives in /api/media/upload (a route handler, because server actions
 * cannot stream a file body); everything else is here.
 */

export type MediaRow = {
  id: string;
  url: string;
  filename: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  createdAt: Date;
};

export async function listMedia(search?: string): Promise<MediaRow[]> {
  await requireSection("sites");
  return prisma.mediaAsset.findMany({
    where: {
      deletedAt: null,
      ...(search?.trim()
        ? { filename: { contains: search.trim(), mode: "insensitive" as const } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, url: true, filename: true, alt: true,
      width: true, height: true, bytes: true, createdAt: true,
    },
  });
}

/**
 * Alt text is edited on the ASSET, not per placement: the same logo used on five pages needs
 * describing once, and an accessibility fix should not mean hunting down every page that uses it.
 */
export async function updateMediaAlt(id: string, alt: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { filename: true } });
  if (!asset) return { ok: false, error: "Image not found" };

  await prisma.mediaAsset.update({ where: { id }, data: { alt: alt.trim() || null } });
  await logActivity(session, {
    action: "media.update",
    section: "sites",
    entityType: "MediaAsset",
    entityId: id,
    summary: `Updated the description of "${asset.filename}"`,
  });
  revalidatePath("/sites");
  return { ok: true };
}

/**
 * Soft delete, and the stored object is deliberately LEFT IN PLACE.
 *
 * A page that still references the URL would otherwise show a broken image the moment someone
 * tidies the library — and there is no reference count to consult, because image URLs live inside
 * a JSON blob rather than a foreign key. Removing the row hides it from the picker, which is what
 * "delete" means to the person clicking it; reclaiming bytes is a separate, deliberate sweep that
 * can check every page first.
 */
export async function deleteMedia(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { filename: true, deletedAt: true },
  });
  if (!asset) return { ok: false, error: "Image not found" };
  if (asset.deletedAt) return { ok: false, error: "That image is already deleted" };

  await prisma.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity(session, {
    action: "media.delete",
    section: "sites",
    entityType: "MediaAsset",
    entityId: id,
    summary: `Removed "${asset.filename}" from the media library`,
  });
  revalidatePath("/sites");
  return { ok: true };
}

/**
 * Permanently destroy the bytes. Admin-gated the same way, but separated from `deleteMedia` so
 * that emptying the library and destroying originals can never be the same click.
 */
export async function purgeMedia(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { filename: true, storageKey: true, deletedAt: true },
  });
  if (!asset) return { ok: false, error: "Image not found" };
  if (!asset.deletedAt) return { ok: false, error: "Remove the image from the library first" };

  const cfg = storageConfig();
  if (!cfg) return { ok: false, error: "Media storage is not configured" };

  const gone = await deleteObject(cfg, asset.storageKey);
  // The row goes only if the object did. A row deleted while its bytes survive is an orphan
  // nothing can ever find again, let alone clean up.
  if (!gone) return { ok: false, error: "Could not delete the stored file — the record was kept" };

  await prisma.mediaAsset.delete({ where: { id } });
  await logActivity(session, {
    action: "media.purge",
    section: "sites",
    entityType: "MediaAsset",
    entityId: id,
    summary: `Permanently deleted "${asset.filename}"`,
  });
  revalidatePath("/sites");
  return { ok: true };
}

/** Whether uploading is available at all — drives the library's empty state. */
export async function mediaStorageReady(): Promise<boolean> {
  await requireSection("sites");
  return storageConfig() !== null;
}
