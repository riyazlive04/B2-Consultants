"use client";

import { useEffect } from "react";

/**
 * Carries the visitor's ad parameters onto outbound links, in the browser.
 *
 * ── Why this is client-side and not done during render ────────────────────────────────────────
 * These pages are STATIC. That is deliberate: the database sits ~680 ms away in another region, so
 * rendering per request would make every ad click wait on a cross-region round trip. But a static
 * page has no request, so the server cannot see `?utm_source=…` - Next hands a statically rendered
 * page an empty `searchParams`, and any forwarding done there would silently produce nothing.
 *
 * So the HTML ships with the plain href and a `data-forward` marker, and the query string is
 * folded in here, where it exists.
 *
 * Two passes, on purpose:
 *   · on mount - so a link is already correct if the visitor inspects or middle-clicks it;
 *   · on click - so a link rendered later, or a click that beats hydration, is still correct.
 * The click handler is the one that actually guarantees attribution; the mount pass is what makes
 * the href honest if anyone looks at it.
 */

const FORWARDED = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "ttclid", "msclkid",
];

const SOURCE_PAGE_PARAM = "b2_from";

function carry(): Record<string, string> {
  const out: Record<string, string> = {};
  const sp = new URLSearchParams(window.location.search);
  for (const k of FORWARDED) {
    const v = sp.get(k);
    if (v) out[k] = v.slice(0, 300);
  }
  out[SOURCE_PAGE_PARAM] = window.location.pathname;
  return out;
}

/** Fold the params into one href. Anything already on the link wins - the author meant it. */
function decorate(href: string, params: Record<string, string>): string | null {
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  let changed = false;
  for (const [k, v] of Object.entries(params)) {
    if (!url.searchParams.has(k)) {
      url.searchParams.set(k, v);
      changed = true;
    }
  }
  return changed ? url.toString() : null;
}

export default function ForwardParams() {
  useEffect(() => {
    const params = carry();

    const apply = (a: HTMLAnchorElement) => {
      const base = a.dataset.href ?? a.getAttribute("href");
      if (!base) return;
      // The original href is stashed so repeated passes decorate the SAME base rather than
      // re-decorating an already-decorated URL.
      a.dataset.href = base;
      const next = decorate(base, params);
      if (next) a.setAttribute("href", next);
    };

    document.querySelectorAll<HTMLAnchorElement>("a[data-forward='1']").forEach(apply);

    // Capture phase: run before any other click handler can navigate.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[data-forward='1']");
      if (a instanceof HTMLAnchorElement) apply(a);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
