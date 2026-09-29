import type { Metadata } from "next";

/**
 * SEO for the PUBLIC pages only - the marketing site (/s), the funnels (/p) and the hosted
 * forms (/f).
 *
 * The dashboard is deliberately NOT covered. It is an internal tool, `src/app/layout.tsx` marks
 * the whole tree `noindex, nofollow`, and that stays true: everything here is opted INTO by the
 * three public routes, never applied globally. Nothing in this file should ever be imported from
 * a page under `(app)/`.
 *
 * Because the layout says noindex, a public page that wants to be indexed must say so EXPLICITLY.
 * Next merges metadata from layout down to page, so "no robots key" means "inherit noindex" - the
 * quiet failure mode this file exists to prevent.
 */

/**
 * The origin this deployment answers on, or null when it cannot be known.
 *
 * BETTER_AUTH_URL first: it is the one origin the app container is REQUIRED to have
 * (docker-compose.prod.yml refuses to boot without it), while APP_DOMAIN is set on the Caddy
 * service and does not reach the app process at all. APP_DOMAIN is still read as a fallback for
 * anyone running the image outside that compose file.
 *
 * Returning null rather than falling back to localhost is the whole point. A canonical tag or an
 * og:url pointing at http://localhost:3000 is far worse than no tag: it tells Google the real
 * page is a duplicate of an address it can never fetch, and it fails SILENTLY - nothing looks
 * broken until the page has quietly dropped out of the index. Every caller below degrades to
 * "emit no URL" instead.
 */
export function publicOrigin(): string | null {
  const base = process.env.BETTER_AUTH_URL?.trim();
  if (base) return base.replace(/\/+$/, "");
  const domain = process.env.APP_DOMAIN?.trim();
  if (domain) return `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
}

/**
 * Canonical URL for one page of the marketing site.
 *
 * A site that has had its DNS cut over owns its own hostname, and THAT is the address the page
 * should be indexed under - not the /s/<slug>/… path on the app domain, which is scaffolding
 * until the domain moves. Serving both without a canonical is how two copies of the same page end
 * up competing with each other in search.
 */
export function siteCanonical(siteDomain: string | null, slug: string, path: string): string | null {
  const tail = path === "/" ? "" : path;
  if (siteDomain) return `https://${siteDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}${tail || "/"}`;
  const origin = publicOrigin();
  return origin ? `${origin}/s/${slug}${tail}` : null;
}

/** Canonical URL for one funnel step. Funnels have no domain of their own - they live on the app. */
export function funnelCanonical(slug: string, step: string): string | null {
  const origin = publicOrigin();
  return origin ? `${origin}/p/${slug}/${step}` : null;
}

/**
 * An og:image has to be an ABSOLUTE url - a relative path is silently dropped by every scraper
 * worth having. Uploaded images already carry a full Supabase storage URL; a path in `public/`
 * does not, so it gets the origin prefixed. Unknowable origin means no image rather than a
 * relative one that renders as a broken preview card.
 */
function absoluteImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const origin = publicOrigin();
  return origin ? `${origin}${url.startsWith("/") ? "" : "/"}${url}` : null;
}

type PublicMetaInput = {
  title: string;
  description?: string | null;
  /** Absolute canonical URL, or null when the origin is unknown - see publicOrigin(). */
  canonical?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
  /** False emits an explicit noindex. It never silently omits the key - see the note above. */
  index: boolean;
};

/**
 * One shape for every public page: title, description, canonical, Open Graph, Twitter card and an
 * explicit robots directive.
 *
 * `follow` stays true even when `index` is false. A funnel step is not something we want in
 * search results, but the links on it (to the site, to a booking page) should still be crawled -
 * nofollow buys nothing here and only throws away the signal.
 */
export function publicMetadata(input: PublicMetaInput): Metadata {
  const origin = publicOrigin();
  const description = input.description?.trim() || undefined;
  const image = absoluteImage(input.imageUrl);
  const url = input.canonical ?? undefined;

  return {
    // Lets any relative URL elsewhere in the metadata resolve. Omitted when unknown, which is the
    // only case where Next would otherwise warn and guess.
    metadataBase: origin ? new URL(origin) : undefined,
    title: input.title,
    description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      type: "website",
      title: input.title,
      description,
      url,
      siteName: input.siteName ?? undefined,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: input.title,
      description,
      images: image ? [image] : undefined,
    },
    robots: input.index
      ? {
          index: true,
          follow: true,
          // Without these Google truncates the snippet and shows a thumbnail-sized image. They
          // are the difference between a listing that sells the page and one that does not.
          googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large", "max-video-preview": -1 },
        }
      : { index: false, follow: true },
  };
}
