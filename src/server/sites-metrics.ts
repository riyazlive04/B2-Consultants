import "server-only";
import { prisma } from "@/lib/prisma";
import {
  normaliseNav,
  normaliseSections,
  normaliseTheme,
  type NavItem,
  type SiteSectionBlock,
  type SiteTheme,
} from "@/lib/site-types";

/**
 * Reads for the website editor and the public renderer.
 *
 * Every path that touches stored JSON runs it through the normalisers on the way out, so a page
 * saved before a field existed renders identically to one saved after - and neither the editor nor
 * the public route ever sees a raw column.
 */

export type SiteListRow = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  published: boolean;
  pageCount: number;
  updatedAt: Date;
};

export async function getSitesList(): Promise<SiteListRow[]> {
  const rows = await prisma.site.findMany({
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
  return rows.map(({ _count, ...s }) => ({ ...s, pageCount: _count.pages }));
}

export type SitePageRow = {
  id: string;
  path: string;
  title: string;
  published: boolean;
  views: number;
  updatedAt: Date;
  sectionCount: number;
};

export type SiteDetail = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  published: boolean;
  theme: SiteTheme;
  nav: NavItem[];
  faviconUrl: string | null;
  metaPixelId: string | null;
  gaMeasurementId: string | null;
  pages: SitePageRow[];
  header: SiteSectionBlock[];
  footer: SiteSectionBlock[];
};

export async function getSiteDetail(id: string): Promise<SiteDetail | null> {
  const site = await prisma.site.findUnique({
    where: { id },
    select: {
      id: true, name: true, slug: true, domain: true, published: true,
      theme: true, navMenu: true, faviconUrl: true, metaPixelId: true, gaMeasurementId: true,
      pages: {
        where: { deletedAt: null },
        orderBy: { path: "asc" },
        select: { id: true, path: true, title: true, published: true, views: true, updatedAt: true, sections: true },
      },
      sections: { select: { kind: true, blocks: true } },
    },
  });
  if (!site) return null;

  const shared = (kind: "HEADER" | "FOOTER") =>
    normaliseSections(site.sections.find((s) => s.kind === kind)?.blocks ?? []);

  return {
    id: site.id,
    name: site.name,
    slug: site.slug,
    domain: site.domain,
    published: site.published,
    theme: normaliseTheme(site.theme),
    nav: normaliseNav(site.navMenu),
    faviconUrl: site.faviconUrl,
    metaPixelId: site.metaPixelId,
    gaMeasurementId: site.gaMeasurementId,
    pages: site.pages.map(({ sections, ...p }) => ({
      ...p,
      sectionCount: normaliseSections(sections).length,
    })),
    header: shared("HEADER"),
    footer: shared("FOOTER"),
  };
}

export type RevisionRow = {
  id: string;
  label: string | null;
  createdAt: Date;
  authorName: string | null;
  sectionCount: number;
};

export type PageDetail = {
  id: string;
  siteId: string;
  siteName: string;
  siteSlug: string;
  siteDomain: string | null;
  path: string;
  title: string;
  published: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  noIndex: boolean;
  sections: SiteSectionBlock[];
  theme: SiteTheme;
  nav: NavItem[];
  header: SiteSectionBlock[];
  footer: SiteSectionBlock[];
  revisions: RevisionRow[];
};

export async function getPageDetail(pageId: string): Promise<PageDetail | null> {
  const page = await prisma.sitePage.findUnique({
    where: { id: pageId },
    select: {
      id: true, siteId: true, path: true, title: true, published: true,
      seoTitle: true, seoDescription: true, ogImageUrl: true, noIndex: true, sections: true,
      site: {
        select: {
          name: true, slug: true, domain: true, theme: true, navMenu: true,
          sections: { select: { kind: true, blocks: true } },
        },
      },
      revisions: {
        // Capped: an autosaving editor produces a revision per save, and the picker only ever
        // shows a recent window. The rest stay in the table for forensics, not for the dropdown.
        take: 30,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, label: true, createdAt: true, sections: true,
          createdBy: { select: { name: true } },
        },
      },
    },
  });
  if (!page) return null;

  const shared = (kind: "HEADER" | "FOOTER") =>
    normaliseSections(page.site.sections.find((s) => s.kind === kind)?.blocks ?? []);

  return {
    id: page.id,
    siteId: page.siteId,
    siteName: page.site.name,
    siteSlug: page.site.slug,
    siteDomain: page.site.domain,
    path: page.path,
    title: page.title,
    published: page.published,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImageUrl: page.ogImageUrl,
    noIndex: page.noIndex,
    sections: normaliseSections(page.sections),
    theme: normaliseTheme(page.site.theme),
    nav: normaliseNav(page.site.navMenu),
    header: shared("HEADER"),
    footer: shared("FOOTER"),
    revisions: page.revisions.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt,
      authorName: r.createdBy?.name ?? null,
      sectionCount: normaliseSections(r.sections).length,
    })),
  };
}

/** The sections stored on one revision - fetched only when the user previews or restores it. */
export async function getRevisionSections(revisionId: string): Promise<SiteSectionBlock[] | null> {
  const rev = await prisma.sitePageRevision.findUnique({
    where: { id: revisionId },
    select: { sections: true },
  });
  return rev ? normaliseSections(rev.sections) : null;
}

// ─────────────────────────── Public ───────────────────────────

export type PublicPage = {
  title: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  noIndex: boolean;
  sections: SiteSectionBlock[];
  theme: SiteTheme;
  nav: NavItem[];
  header: SiteSectionBlock[];
  footer: SiteSectionBlock[];
  siteDomain: string | null;
  metaPixelId: string | null;
  gaMeasurementId: string | null;
};

/**
 * Resolve a public page by site slug and path.
 *
 * Both the site AND the page must be published - an unpublished page on a live site must not be
 * reachable by guessing its path, and unpublishing a whole site must take every page with it.
 */
export async function getPublicPage(siteSlug: string, path: string): Promise<PublicPage | null> {
  const site = await prisma.site.findFirst({
    where: { slug: siteSlug, published: true },
    select: {
      domain: true, theme: true, navMenu: true, metaPixelId: true, gaMeasurementId: true,
      sections: { select: { kind: true, blocks: true } },
      pages: {
        where: { path, published: true, deletedAt: null },
        take: 1,
        select: {
          title: true, seoTitle: true, seoDescription: true, ogImageUrl: true,
          noIndex: true, sections: true,
        },
      },
    },
  });
  const page = site?.pages[0];
  if (!site || !page) return null;

  const shared = (kind: "HEADER" | "FOOTER") =>
    normaliseSections(site.sections.find((s) => s.kind === kind)?.blocks ?? []);

  return {
    title: page.title,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImageUrl: page.ogImageUrl,
    noIndex: page.noIndex,
    sections: normaliseSections(page.sections),
    theme: normaliseTheme(site.theme),
    nav: normaliseNav(site.navMenu),
    header: shared("HEADER"),
    footer: shared("FOOTER"),
    siteDomain: site.domain,
    metaPixelId: site.metaPixelId,
    gaMeasurementId: site.gaMeasurementId,
  };
}

/** Every published path on a site - for the sitemap. */
export async function getPublishedPaths(siteSlug: string): Promise<string[]> {
  const rows = await prisma.sitePage.findMany({
    where: { site: { slug: siteSlug, published: true }, published: true, deletedAt: null, noIndex: false },
    select: { path: true },
  });
  return rows.map((r) => r.path);
}

/**
 * Every published (site, path) pair, for `generateStaticParams`.
 *
 * Prerendering these at build time is what makes the route STATIC rather than server-rendered on
 * demand - and that is the difference between a page a CDN can cache and one that emits
 * `Cache-Control: no-store` and hits a database 680 ms away on every single ad click.
 *
 * Returns [] rather than throwing if the database is unreachable at build time. A marketing page
 * that renders on demand is slower; a build that fails because the DB blinked is an outage.
 */
export async function getAllPublishedPageParams(): Promise<{ slug: string; path?: string[] }[]> {
  try {
    const rows = await prisma.sitePage.findMany({
      where: { published: true, deletedAt: null, site: { published: true } },
      select: { path: true, site: { select: { slug: true } } },
    });
    return rows.map((r) => ({
      slug: r.site.slug,
      // "/" has no segments at all - the optional catch-all matches it with `path` absent, and
      // passing [""] would prerender "/s/<slug>/" instead, which is a different URL.
      path: r.path === "/" ? undefined : r.path.replace(/^\//, "").split("/"),
    }));
  } catch {
    return [];
  }
}
