/**
 * Attribution forwarding across the hostname boundary.
 *
 * ── The problem this exists for ────────────────────────────────────────────────────────────────
 * The marketing site is being rebuilt on this app, but the opt-in funnel stays on GHL at
 * optin.b2consultants.de. So the money path crosses hostnames:
 *
 *     b2consultants.de/  →  [Watch Free Training]  →  optin.b2consultants.de/lp  →  opt-in
 *
 * Different hostname means no shared cookie and no shared session. A visitor who arrived from a
 * Meta ad carrying `utm_source=facebook&fbclid=…` lands on our page with that context, clicks the
 * CTA, and - unless we carry it - arrives at the funnel with nothing. Every opt-in then looks like
 * direct traffic.
 *
 * The cost is not abstract. The whole point of rebuilding these pages is to answer "does the new
 * homepage convert better than the GHL one?", and that question is unanswerable if the opt-in
 * cannot be traced back to the page that produced it.
 *
 * So: forward the ad params, and stamp which page sent them.
 */

/**
 * Params worth carrying. An allow-list, not "everything": the query string on a landing page also
 * collects junk (session ids, preview flags, a stray `?fbclid=` doubled by a redirect), and
 * forwarding the lot both leaks internal state onto a third-party host and makes the funnel's own
 * analytics harder to read, not easier.
 */
const FORWARDED = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  // Click identifiers - the ONLY reliable join key back to an ad platform's own reporting. UTMs
  // are author-supplied and get mistyped; these are minted by the platform.
  "fbclid",
  "gclid",
  "ttclid",
  "msclkid",
] as const;

/** Names the page that sent the visitor onward. Deliberately prefixed so it cannot collide with a
 *  param the funnel or an ad platform already uses. */
export const SOURCE_PAGE_PARAM = "b2_from";

export type IncomingParams = Record<string, string | string[] | undefined>;

/** Pull the forwardable params out of a Next.js `searchParams` object. */
export function pickForwardable(sp: IncomingParams | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!sp) return out;
  for (const key of FORWARDED) {
    const v = sp[key];
    // An array means the param was repeated (`?utm_source=a&utm_source=b`). Take the first: it is
    // the one the ad platform set, before whatever appended the duplicate.
    const value = Array.isArray(v) ? v[0] : v;
    if (typeof value === "string" && value) out[key] = value.slice(0, 300);
  }
  return out;
}

/**
 * Build the outgoing href for a CTA or nav item.
 *
 * Returns `href` untouched when forwarding is off, when there is nothing to forward, or when the
 * target is not an http(s)/relative URL - a `mailto:` or `tel:` link has no query string to carry
 * and appending one would corrupt it.
 *
 * Params ALREADY present on the href win. An author who wrote `?utm_campaign=spring` on the button
 * meant it, and silently overwriting their value with the visitor's inbound one would make the
 * link do something other than what it says.
 */
export function buildForwardedHref(
  href: string,
  opts: {
    forwardParams?: boolean;
    incoming?: Record<string, string>;
    /** Path of the page carrying this link, stamped as `b2_from`. */
    fromPath?: string;
  } = {},
): string {
  const { forwardParams, incoming, fromPath } = opts;
  if (!forwardParams || !href) return href;

  const carry = { ...(incoming ?? {}) };
  if (fromPath) carry[SOURCE_PAGE_PARAM] = fromPath;
  if (Object.keys(carry).length === 0) return href;

  // Relative targets are resolved against a throwaway base purely so URL() will parse them; only
  // the path and query are read back out, so the base never escapes.
  const RELATIVE_BASE = "https://b2.invalid";
  let url: URL;
  try {
    url = new URL(href, RELATIVE_BASE);
  } catch {
    return href;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return href;

  for (const [k, v] of Object.entries(carry)) {
    if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  }

  const isRelative = url.origin === RELATIVE_BASE && !/^https?:\/\//i.test(href);
  return isRelative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

/**
 * Whether a link leaves this site. Used by the renderer to decide `target`/`rel` - and it is why
 * `forwardParams` is opt-in per link rather than global: forwarding to our OWN pages is harmless
 * but noisy, while forwarding to the GHL funnel is the entire point.
 */
export function isExternalHref(href: string, siteDomain?: string | null): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  if (!siteDomain) return true;
  try {
    return new URL(href).hostname.toLowerCase() !== siteDomain.toLowerCase();
  } catch {
    return true;
  }
}
