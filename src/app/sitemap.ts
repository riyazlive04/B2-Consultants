import type { MetadataRoute } from "next";
import { getSitemapPages } from "@/server/sites-metrics";
import { siteCanonical } from "@/lib/public-seo";

/**
 * The sitemap - marketing site pages ONLY.
 *
 * Three whole categories are deliberately absent:
 *  - the dashboard, which is an internal tool and is `noindex, nofollow` from its root layout
 *  - the funnels under /p, which are ad destinations and thank-you screens; they carry noindex of
 *    their own, and listing a noindex URL in a sitemap is a contradiction Search Console reports
 *    back as an error rather than an insight
 *  - the hosted forms under /f, for the same reason
 *
 * Sitemaps are a discovery hint, not an instruction. What actually decides indexing is the robots
 * meta tag on each page, which is why `getSitemapPages` filters on the SAME `noIndex` column the
 * page reads - the two can never disagree.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = await getSitemapPages();

  return pages
    .map((p) => {
      const url = siteCanonical(p.domain, p.slug, p.path);
      // Unknowable origin and no domain of its own: there is no honest URL to publish for this
      // page, and a guessed one would be worse than leaving it out. See publicOrigin().
      if (!url) return null;
      return {
        url,
        lastModified: p.updatedAt,
        // The home page is the one worth recrawling often; the rest are near-static brochure pages.
        changeFrequency: (p.path === "/" ? "weekly" : "monthly") as "weekly" | "monthly",
        priority: p.path === "/" ? 1 : 0.7,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

