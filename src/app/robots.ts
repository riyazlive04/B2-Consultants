import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/public-seo";

/**
 * robots.txt - allow the public marketing surface, disallow the dashboard.
 *
 * `Disallow: /` with narrower `Allow:` rules above it is deliberate, and it is the right way round
 * for this app: everything is internal EXCEPT four prefixes. Crawlers resolve conflicting rules by
 * the most specific match, not by order, so /s/... stays crawlable while /finance, /students and
 * /my-desk are never fetched at all.
 *
 * Two entries that look wrong and are not:
 *  - /_next/ must be allowed. Google renders a page before judging it, and a crawler that cannot
 *    fetch the CSS and JS sees an unstyled skeleton and ranks it accordingly. This exposes build
 *    assets, which are public to any visitor's browser already.
 *  - /p/ and /f/ are allowed even though both are noindex. A disallowed URL is never FETCHED, so
 *    the noindex on it is never read - and neither is the Open Graph card, which is what makes a
 *    funnel link shared on WhatsApp render as a preview instead of a bare link. Allow the fetch,
 *    let the page's own robots meta decide the indexing.
 *
 * ── READ THIS BEFORE POINTING A REAL DOMAIN AT THIS APP ───────────────────────────────────────
 * This file is correct only while the marketing site lives under /s/<slug>/. The moment
 * Site.domain is set and b2consultants.de resolves here, the site's home page IS "/" - and "/" is
 * the one path this file disallows. robots.txt is served per HOST, but this route is static and
 * cannot see which host asked, so the same rules go out to both. The canonical tag will point at
 * https://b2consultants.de/ while robots.txt on that very domain refuses it.
 *
 * The fix at that point is to make this route host-aware (read the Host header, and serve the
 * open ruleset for a domain that belongs to a Site) rather than to widen the rules here - the
 * dashboard shares this origin, and "Disallow: /" is what keeps /finance and /students out.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = publicOrigin();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/s/", "/p/", "/f/", "/media/", "/_next/"],
        disallow: "/",
      },
    ],
    sitemap: origin ? `${origin}/sitemap.xml` : undefined,
  };
}
