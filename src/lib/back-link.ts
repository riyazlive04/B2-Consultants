/**
 * WHERE "BACK" GOES, when a page can be reached from more than one list.
 *
 * A cohort is linked to from four screens - Attendance, My Teaching, Students → Batches and
 * Batches & Plans - and `/batches/[batchId]` used to hard-code its back link from the viewer's
 * ROLE ("Students" for a founder, "My Teaching" for a coach). So opening a cohort from the
 * register desk left no way back to it: the only link on the page pointed somewhere you had not
 * been, and the answer was the browser's own Back button, which is not an answer.
 *
 * A KEY, NEVER A URL. The origin travels as `?back=attendance` and is resolved against the table
 * below; anything unrecognised falls back to the caller's default. A raw `?back=/some/url`
 * echoed into an href would make every one of these pages a redirect of someone else's choosing,
 * and there is nothing this feature needs that a short whitelist cannot express.
 *
 * Pure, no "server-only": both server pages and client link-builders import it.
 */

export type BackKey = "attendance" | "coaching" | "students" | "german-note" | "batches";

export type BackLink = { href: string; label: string };

const BACK_LINKS: Record<BackKey, BackLink> = {
  attendance: { href: "/attendance", label: "Attendance" },
  coaching: { href: "/coaching", label: "My Teaching" },
  students: { href: "/students", label: "Students" },
  "german-note": { href: "/german-note", label: "German Note" },
  batches: { href: "/batches", label: "Batches & Plans" },
};

/** Append the origin to a link, so the page it opens knows which list to offer back. */
export function withBack(href: string, key: BackKey): string {
  return `${href}${href.includes("?") ? "&" : "?"}back=${key}`;
}

/**
 * Resolve `?back=` to a link, or the caller's default when it names nothing we know.
 *
 * The default still matters and is still role-shaped: plenty of arrivals carry no origin at all
 * - a bookmark, a WhatsApp link, a browser refresh - and those should land on whichever list
 * that person actually has.
 */
export function resolveBackLink(raw: string | undefined | null, fallback: BackLink): BackLink {
  if (!raw) return fallback;
  /*
    `Object.hasOwn`, not a bare lookup, and the test for it is not academic: `BACK_LINKS["__proto__"]`
    on an object literal returns `Object.prototype`, which is an object and therefore truthy - so
    `?? fallback` never fires and the caller is handed a link with no `href` at all. Every string
    off the query string reaches this line.
  */
  return Object.hasOwn(BACK_LINKS, raw) ? BACK_LINKS[raw as BackKey] : fallback;
}
