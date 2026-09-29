"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type SiteSectionKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection, capabilityCheck } from "@/lib/rbac";
import {
  defaultTheme,
  normaliseNav,
  normalisePath,
  normaliseSections,
  normaliseTheme,
  type NavItem,
  type SiteSectionBlock,
  type SiteTheme,
} from "@/lib/site-types";
import { logActivity, diffFields } from "./activity-log";
import type { ActionResult } from "./finance-actions";

/**
 * The marketing website - pages, shared header/footer, theme and nav.
 *
 * Every write here is gated on `sites.manage`, NOT on the section alone. Reaching /sites is a read
 * decision; publishing is an outward-facing one that changes what every ad click lands on, so it
 * gets a capability of its own rather than the `pipeline.configure` these actions would otherwise
 * have borrowed (see lib/capabilities.ts for why those two powers are unrelated).
 *
 * Public rendering is unauthenticated and gated on `published`, never on this key.
 */

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

/** Cheap guard against a paste of the whole GHL page into one field. */
const MAX_SECTIONS_BYTES = 512_000;

function sectionsTooBig(sections: SiteSectionBlock[]): boolean {
  return JSON.stringify(sections).length > MAX_SECTIONS_BYTES;
}

/** Revalidate every surface a site change can show up on: the editor and the public routes. */
function revalidateSite(siteSlug: string, path?: string) {
  revalidatePath("/sites");
  revalidatePath(`/s/${siteSlug}`, "layout");
  if (path) revalidatePath(`/s/${siteSlug}${path === "/" ? "" : path}`);
}

// ─────────────────────────── Site ───────────────────────────

export async function createSite(form: FormData): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const name = String(form.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Site name is required" };

  const slug = normalisePath(String(form.get("slug") ?? name)).replace(/^\//, "") || "site";
  const clash = await prisma.site.findUnique({ where: { slug }, select: { id: true } });
  if (clash) return { ok: false, error: `The URL prefix "${slug}" is already taken` };

  const row = await prisma.site.create({
    data: {
      name,
      slug,
      theme: json(defaultTheme()),
      navMenu: json([] satisfies NavItem[]),
      createdById: session.user.id,
    },
  });

  await logActivity(session, {
    action: "site.create",
    section: "sites",
    entityType: "Site",
    entityId: row.id,
    summary: `Created the website "${name}"`,
    meta: { slug },
  });
  revalidatePath("/sites");
  return { ok: true };
}

export async function updateSiteSettings(
  id: string,
  input: {
    name?: string;
    theme?: SiteTheme;
    navMenu?: NavItem[];
    faviconUrl?: string | null;
    metaPixelId?: string | null;
    gaMeasurementId?: string | null;
  },
): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const before = await prisma.site.findUnique({
    where: { id },
    select: { name: true, slug: true, metaPixelId: true, gaMeasurementId: true },
  });
  if (!before) return { ok: false, error: "Site not found" };

  const name = input.name?.trim();
  if (input.name !== undefined && !name) return { ok: false, error: "Site name is required" };

  await prisma.site.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      // Re-normalised on the way IN as well as out: a client can post anything, and the public
      // renderer must never be the first place a malformed theme is discovered.
      ...(input.theme ? { theme: json(normaliseTheme(input.theme)) } : {}),
      ...(input.navMenu ? { navMenu: json(normaliseNav(input.navMenu)) } : {}),
      ...(input.faviconUrl !== undefined ? { faviconUrl: input.faviconUrl || null } : {}),
      ...(input.metaPixelId !== undefined ? { metaPixelId: input.metaPixelId?.trim() || null } : {}),
      ...(input.gaMeasurementId !== undefined
        ? { gaMeasurementId: input.gaMeasurementId?.trim() || null }
        : {}),
    },
  });

  const d = diffFields(
    { name: before.name, metaPixelId: before.metaPixelId ?? "", gaMeasurementId: before.gaMeasurementId ?? "" },
    {
      name: name ?? before.name,
      metaPixelId: input.metaPixelId !== undefined ? input.metaPixelId ?? "" : before.metaPixelId ?? "",
      gaMeasurementId:
        input.gaMeasurementId !== undefined ? input.gaMeasurementId ?? "" : before.gaMeasurementId ?? "",
    },
  );
  await logActivity(session, {
    action: "site.update",
    section: "sites",
    entityType: "Site",
    entityId: id,
    summary: `Updated settings for the website "${before.name}"`,
    meta: { changed: d.changed, before: d.before, after: d.after },
  });
  revalidateSite(before.slug);
  return { ok: true };
}

/**
 * Attach the real hostname. Separate from updateSiteSettings because this is the DNS cut-over -
 * the single most consequential switch in the project, and it should read like one in the log.
 */
export async function setSiteDomain(id: string, domain: string | null): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const site = await prisma.site.findUnique({ where: { id }, select: { name: true, slug: true, domain: true } });
  if (!site) return { ok: false, error: "Site not found" };

  const next = domain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  if (next && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(next)) {
    return { ok: false, error: "That does not look like a hostname" };
  }
  if (next) {
    const clash = await prisma.site.findUnique({ where: { domain: next }, select: { id: true } });
    if (clash && clash.id !== id) return { ok: false, error: `${next} is already attached to another site` };
  }

  await prisma.site.update({ where: { id }, data: { domain: next } });
  await logActivity(session, {
    action: "site.domain",
    section: "sites",
    entityType: "Site",
    entityId: id,
    summary: next
      ? `Pointed ${next} at the website "${site.name}"`
      : `Detached ${site.domain ?? "the domain"} from the website "${site.name}"`,
    meta: { before: site.domain, after: next },
  });
  revalidateSite(site.slug);
  return { ok: true };
}

export async function togglePublishSite(id: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const site = await prisma.site.findUnique({
    where: { id },
    select: { name: true, slug: true, published: true, _count: { select: { pages: true } } },
  });
  if (!site) return { ok: false, error: "Site not found" };
  if (!site.published && site._count.pages === 0) {
    return { ok: false, error: "Add at least one page before publishing" };
  }

  await prisma.site.update({ where: { id }, data: { published: !site.published } });
  await logActivity(session, {
    action: site.published ? "site.unpublish" : "site.publish",
    section: "sites",
    entityType: "Site",
    entityId: id,
    summary: `${site.published ? "Unpublished" : "Published"} the website "${site.name}"`,
  });
  revalidateSite(site.slug);
  return { ok: true };
}

// ─────────────────────────── Pages ───────────────────────────

export async function createPage(siteId: string, title: string, path: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;
  if (!title.trim()) return { ok: false, error: "Page title is required" };

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { slug: true, name: true } });
  if (!site) return { ok: false, error: "Site not found" };

  const p = normalisePath(path || title);
  const clash = await prisma.sitePage.findUnique({
    where: { siteId_path: { siteId, path: p } },
    select: { id: true, deletedAt: true },
  });
  // A soft-deleted page still owns its path - say so, rather than failing on a unique constraint
  // with a message nobody can act on.
  if (clash) {
    return {
      ok: false,
      error: clash.deletedAt
        ? `${p} belongs to a deleted page - restore it, or pick another path`
        : `${p} is already in use`,
    };
  }

  const row = await prisma.sitePage.create({
    data: { siteId, title: title.trim(), path: p, sections: json([] satisfies SiteSectionBlock[]) },
  });
  await logActivity(session, {
    action: "site.page.create",
    section: "sites",
    entityType: "SitePage",
    entityId: row.id,
    summary: `Added the page "${title.trim()}" (${p}) to "${site.name}"`,
    meta: { siteId, path: p },
  });
  revalidateSite(site.slug, p);
  return { ok: true };
}

/**
 * Save a page body, snapshotting the previous content first.
 *
 * The revision is written in the SAME transaction as the update: a snapshot that can be missing
 * when the save succeeds is not a safety net, and this site takes paid traffic - a bad edit needs
 * a guaranteed way back, not a usually-there one.
 */
export async function savePageSections(
  pageId: string,
  sections: SiteSectionBlock[],
  label?: string,
): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const page = await prisma.sitePage.findUnique({
    where: { id: pageId },
    select: { title: true, path: true, sections: true, site: { select: { slug: true } } },
  });
  if (!page) return { ok: false, error: "Page not found" };

  const clean = normaliseSections(sections);
  if (sectionsTooBig(clean)) return { ok: false, error: "This page is too large to save" };

  await prisma.$transaction([
    prisma.sitePageRevision.create({
      data: {
        pageId,
        sections: json(page.sections),
        label: label?.trim() || null,
        createdById: session.user.id,
      },
    }),
    prisma.sitePage.update({ where: { id: pageId }, data: { sections: json(clean) } }),
  ]);

  await logActivity(session, {
    action: "site.page.update",
    section: "sites",
    entityType: "SitePage",
    entityId: pageId,
    summary: `Edited the page "${page.title}" (${page.path})`,
    meta: { sections: clean.length, label: label?.trim() || null },
  });
  revalidateSite(page.site.slug, page.path);
  return { ok: true };
}

export async function updatePageMeta(
  pageId: string,
  input: {
    title?: string;
    path?: string;
    seoTitle?: string | null;
    seoDescription?: string | null;
    ogImageUrl?: string | null;
    noIndex?: boolean;
  },
): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const page = await prisma.sitePage.findUnique({
    where: { id: pageId },
    select: { siteId: true, title: true, path: true, seoTitle: true, site: { select: { slug: true } } },
  });
  if (!page) return { ok: false, error: "Page not found" };

  const title = input.title?.trim();
  if (input.title !== undefined && !title) return { ok: false, error: "Page title is required" };

  let path = page.path;
  if (input.path !== undefined) {
    path = normalisePath(input.path);
    if (path !== page.path) {
      const clash = await prisma.sitePage.findUnique({
        where: { siteId_path: { siteId: page.siteId, path } },
        select: { id: true },
      });
      if (clash) return { ok: false, error: `${path} is already in use` };
    }
  }

  await prisma.sitePage.update({
    where: { id: pageId },
    data: {
      ...(title ? { title } : {}),
      ...(input.path !== undefined ? { path } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle?.trim() || null } : {}),
      ...(input.seoDescription !== undefined
        ? { seoDescription: input.seoDescription?.trim() || null }
        : {}),
      ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl || null } : {}),
      ...(input.noIndex !== undefined ? { noIndex: input.noIndex } : {}),
    },
  });

  const d = diffFields(
    { title: page.title, path: page.path },
    { title: title ?? page.title, path },
  );
  await logActivity(session, {
    action: "site.page.meta",
    section: "sites",
    entityType: "SitePage",
    entityId: pageId,
    // A path change breaks every inbound link to the old one, so it is called out by name rather
    // than buried in a generic "updated" line.
    summary:
      path !== page.path
        ? `Moved the page "${page.title}" from ${page.path} to ${path}`
        : `Updated details for the page "${page.title}"`,
    meta: { changed: d.changed, before: d.before, after: d.after },
  });
  revalidateSite(page.site.slug, path);
  if (path !== page.path) revalidateSite(page.site.slug, page.path);
  return { ok: true };
}

export async function togglePublishPage(pageId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const page = await prisma.sitePage.findUnique({
    where: { id: pageId },
    select: { title: true, path: true, published: true, sections: true, site: { select: { slug: true } } },
  });
  if (!page) return { ok: false, error: "Page not found" };
  if (!page.published && normaliseSections(page.sections).length === 0) {
    return { ok: false, error: "Add a section before publishing this page" };
  }

  await prisma.sitePage.update({ where: { id: pageId }, data: { published: !page.published } });
  await logActivity(session, {
    action: page.published ? "site.page.unpublish" : "site.page.publish",
    section: "sites",
    entityType: "SitePage",
    entityId: pageId,
    summary: `${page.published ? "Unpublished" : "Published"} the page "${page.title}" (${page.path})`,
  });
  revalidateSite(page.site.slug, page.path);
  return { ok: true };
}

/**
 * Soft delete. The row is kept because its revisions are the only record of what the page said,
 * and because an accidental delete of a live marketing page is exactly the mistake worth being
 * able to undo. The path stays claimed - see createPage.
 */
export async function deletePage(pageId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const page = await prisma.sitePage.findUnique({
    where: { id: pageId },
    select: { title: true, path: true, deletedAt: true, site: { select: { slug: true } } },
  });
  if (!page) return { ok: false, error: "Page not found" };
  if (page.deletedAt) return { ok: false, error: "That page is already deleted" };

  // Unpublished at the same time: a soft-deleted page that is still `published` would keep
  // serving to the public, which is not what anyone means by "delete".
  await prisma.sitePage.update({
    where: { id: pageId },
    data: { deletedAt: new Date(), published: false },
  });
  await logActivity(session, {
    action: "site.page.delete",
    section: "sites",
    entityType: "SitePage",
    entityId: pageId,
    summary: `Deleted the page "${page.title}" (${page.path})`,
  });
  revalidateSite(page.site.slug, page.path);
  return { ok: true };
}

export async function restorePage(pageId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const page = await prisma.sitePage.findUnique({
    where: { id: pageId },
    select: { title: true, path: true, deletedAt: true, site: { select: { slug: true } } },
  });
  if (!page) return { ok: false, error: "Page not found" };
  if (!page.deletedAt) return { ok: false, error: "That page is not deleted" };

  // Restored as a DRAFT, never straight back to live: whoever deleted it had a reason, and
  // republishing is a separate, deliberate decision.
  await prisma.sitePage.update({ where: { id: pageId }, data: { deletedAt: null } });
  await logActivity(session, {
    action: "site.page.restore",
    section: "sites",
    entityType: "SitePage",
    entityId: pageId,
    summary: `Restored the page "${page.title}" (${page.path}) as a draft`,
  });
  revalidateSite(page.site.slug, page.path);
  return { ok: true };
}

// ─────────────────────────── Revisions ───────────────────────────

/** Restore a snapshot. Itself a save, so the state being replaced is snapshotted too. */
export async function restoreRevision(revisionId: string): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const rev = await prisma.sitePageRevision.findUnique({
    where: { id: revisionId },
    select: {
      sections: true,
      createdAt: true,
      page: { select: { id: true, title: true, path: true, sections: true, site: { select: { slug: true } } } },
    },
  });
  if (!rev) return { ok: false, error: "Revision not found" };

  await prisma.$transaction([
    prisma.sitePageRevision.create({
      data: {
        pageId: rev.page.id,
        sections: json(rev.page.sections),
        label: "Before restore",
        createdById: session.user.id,
      },
    }),
    prisma.sitePage.update({ where: { id: rev.page.id }, data: { sections: json(rev.sections) } }),
  ]);

  await logActivity(session, {
    action: "site.page.restore-revision",
    section: "sites",
    entityType: "SitePage",
    entityId: rev.page.id,
    summary: `Restored the page "${rev.page.title}" to its ${rev.createdAt.toISOString().slice(0, 16).replace("T", " ")} version`,
    meta: { revisionId },
  });
  revalidateSite(rev.page.site.slug, rev.page.path);
  return { ok: true };
}

// ─────────────────────────── Shared sections (header / footer) ───────────────────────────

export async function saveSharedSection(
  siteId: string,
  kind: SiteSectionKind,
  name: string,
  blocks: SiteSectionBlock[],
): Promise<ActionResult> {
  const { allowed, denied, session } = await capabilityCheck("sites.manage");
  if (!allowed) return denied;

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { slug: true, name: true } });
  if (!site) return { ok: false, error: "Site not found" };

  const clean = normaliseSections(blocks);
  if (sectionsTooBig(clean)) return { ok: false, error: "This section is too large to save" };

  // HEADER and FOOTER are singletons per site - there is one header, and "save the header" must
  // mean replace it, not accumulate a second one nobody can see. REUSABLE blocks are many.
  const existing =
    kind === "REUSABLE"
      ? null
      : await prisma.siteSection.findFirst({ where: { siteId, kind }, select: { id: true } });

  if (existing) {
    await prisma.siteSection.update({ where: { id: existing.id }, data: { name, blocks: json(clean) } });
  } else {
    await prisma.siteSection.create({ data: { siteId, kind, name, blocks: json(clean) } });
  }

  await logActivity(session, {
    action: "site.section.save",
    section: "sites",
    entityType: "SiteSection",
    entityId: existing?.id ?? siteId,
    summary: `Saved the ${kind.toLowerCase()} for "${site.name}"`,
  });
  // Shared sections appear on every page, so this invalidates the whole site rather than one path.
  revalidateSite(site.slug);
  return { ok: true };
}

// ─────────────────────────── Reads ───────────────────────────

/** The editor's site list. Section-gated only: seeing the list is not a write. */
export async function listSites() {
  await requireSection("sites");
  return prisma.site.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      domain: true,
      published: true,
      updatedAt: true,
      _count: { select: { pages: { where: { deletedAt: null } } } },
    },
  });
}
