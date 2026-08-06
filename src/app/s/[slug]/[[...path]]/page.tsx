import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllPublishedPageParams, getPublicPage } from "@/server/sites-metrics";
import SitePageRenderer from "@/components/sites/SitePageRenderer";
import ForwardParams from "@/components/sites/ForwardParams";
import SiteTracking from "@/components/sites/SiteTracking";

/**
 * The public marketing site, served at /s/<slug>/<path> until a real domain is attached.
 *
 * ── Why this is cached, unlike /p/* ───────────────────────────────────────────────────────────
 * The funnel route renders dynamically and writes a view count on every request. Measured from the
 * VPS, the database is ~680 ms away (Supabase, ap-southeast-1), so that pattern makes every
 * visitor wait on a cross-region round trip plus a write before seeing anything. Tolerable behind
 * an emailed funnel link; fatal for a page taking paid traffic.
 *
 * `revalidate` is only the backstop: publishing and saving call revalidatePath, so an edit goes
 * live immediately rather than after the window expires.
 *
 * ── And why searchParams is NOT read here ─────────────────────────────────────────────────────
 * Reading `searchParams` opts a page out of static rendering entirely — which would hand back the
 * per-request latency this route exists to avoid. A statically rendered page has no request to
 * read a query string from, so attribution forwarding cannot happen on the server at all; doing it
 * here would silently produce nothing. <ForwardParams /> does it in the browser instead, where the
 * query string exists.
 */
export const revalidate = 300;

/**
 * Prerender every published page at build time.
 *
 * Without this the route is "server-rendered on demand": Next cannot prerender a catch-all it has
 * no params for, so it renders dynamically and emits `Cache-Control: private, no-store` — which no
 * CDN or browser will ever cache, and every ad click pays the full cross-region database round
 * trip. Measured before adding this: `no-store` on both a cold and a warm request.
 *
 * `dynamicParams` stays at its default of true, so a page published after the last build still
 * resolves — it is just rendered on demand until the next deploy, rather than 404ing.
 */
export async function generateStaticParams() {
  return getAllPublishedPageParams();
}

/** A catch-all gives us `path` as segments; the stored page path is a single leading-slash string. */
function toPath(segments?: string[]): string {
  if (!segments || segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string; path?: string[] };
}): Promise<Metadata> {
  const page = await getPublicPage(params.slug, toPath(params.path));
  if (!page) return { title: "Not found" };
  return {
    title: page.seoTitle || page.title,
    description: page.seoDescription ?? undefined,
    openGraph: page.ogImageUrl ? { images: [page.ogImageUrl] } : undefined,
    robots: page.noIndex ? { index: false, follow: false } : undefined,
  };
}

export default async function PublicSitePage({
  params,
}: {
  params: { slug: string; path?: string[] };
}) {
  const path = toPath(params.path);
  const page = await getPublicPage(params.slug, path);
  if (!page) notFound();

  return (
    <>
      <SitePageRenderer
        sections={page.sections}
        header={page.header}
        footer={page.footer}
        theme={page.theme}
        nav={page.nav}
        // Empty by design — see the note above. The browser fills this in.
        incoming={{}}
        fromPath={path}
        siteDomain={page.siteDomain}
      />
      <ForwardParams />
      <SiteTracking metaPixelId={page.metaPixelId} gaMeasurementId={page.gaMeasurementId} />
    </>
  );
}
