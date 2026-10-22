/**
 * Resources - pure rules for course material attached to a curriculum row, a batch or a class.
 *
 * NO prisma, NO server-only: the student's classroom, the coach's batch page and the admin's
 * curriculum editor all render from here, and the write path validates with the same functions.
 */

export type ResourceScope = "curriculumItem" | "batch" | "session";

export type ResourceKindValue = "DOCUMENT" | "VIDEO" | "TEMPLATE" | "TOOL" | "LINK";

export const RESOURCE_KINDS: readonly ResourceKindValue[] = [
  "DOCUMENT",
  "VIDEO",
  "TEMPLATE",
  "TOOL",
  "LINK",
] as const;

export const RESOURCE_KIND_LABELS: Record<ResourceKindValue, string> = {
  DOCUMENT: "Document",
  VIDEO: "Video",
  TEMPLATE: "Template",
  TOOL: "Tool",
  LINK: "Link",
};

/** What the student is being asked to DO with it - the verb on the button. */
export const RESOURCE_KIND_ACTION: Record<ResourceKindValue, string> = {
  DOCUMENT: "Open",
  VIDEO: "Watch",
  TEMPLATE: "Get a copy",
  TOOL: "Open",
  LINK: "Open",
};

/**
 * Where a resource sits, in the words the UI uses.
 *
 * `curriculumItem` is the one worth explaining on screen, because it is the only scope whose
 * effect is invisible from the batch you are looking at: it reaches every cohort, including ones
 * that do not exist yet.
 */
export const SCOPE_LABELS: Record<ResourceScope, string> = {
  curriculumItem: "Every cohort",
  batch: "This cohort",
  session: "This class",
};

export type ResourceScopeRef = {
  curriculumItemId?: string | null;
  batchId?: string | null;
  sessionId?: string | null;
};

/**
 * Which scope a row carries, or null when it carries none or several.
 *
 * The database has a CHECK constraint saying exactly one is set; this is the same rule where the
 * write path can give a readable error instead of a constraint violation.
 */
export function scopeOf(ref: ResourceScopeRef): ResourceScope | null {
  const set: ResourceScope[] = [];
  if (ref.curriculumItemId) set.push("curriculumItem");
  if (ref.batchId) set.push("batch");
  if (ref.sessionId) set.push("session");
  return set.length === 1 ? set[0] : null;
}

/**
 * Is this a link we are willing to put in front of a student?
 *
 * http(s) only. A `javascript:` URL rendered into an anchor is a stored-XSS primitive, and
 * `data:` is a way to smuggle a document past every other check - neither is ever a legitimate
 * course material link, so both fail closed rather than being sanitised into something.
 */
export function isSafeResourceUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * The host, for the small grey line under a resource title.
 *
 * Worth showing: "drive.google.com" and "some-random-shortener.io" are the same length on screen
 * and very different things to click, and the student is being asked to trust a link posted by
 * someone else.
 */
export function hostOf(raw: string): string | null {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Guess what a pasted link IS, so the form arrives pre-answered.
 *
 * A guess, never a verdict - the form shows it as the selected option and the person can change
 * it. Getting this right most of the time is the difference between a two-field paste and a
 * five-field form.
 */
export function guessKind(raw: string): ResourceKindValue {
  const url = raw.trim().toLowerCase();
  if (!url) return "LINK";
  if (/\.(pdf|docx?|pptx?|xlsx?|csv)(\?|#|$)/.test(url)) return "DOCUMENT";
  if (/youtube\.com|youtu\.be|vimeo\.com|fathom\.video|loom\.com/.test(url)) return "VIDEO";
  if (/docs\.google\.com\/(document|presentation|spreadsheets)/.test(url)) return "TEMPLATE";
  if (/drive\.google\.com|dropbox\.com|onedrive|sharepoint/.test(url)) return "DOCUMENT";
  if (/notion\.so|airtable\.com|linkedin\.com|xing\.com|stepstone|indeed/.test(url)) return "TOOL";
  return "LINK";
}

export type SortableResource = { orderIndex: number; title: string };

/** Display order: the order staff put them in, then alphabetically for anything tied. */
export function sortResources<T extends SortableResource>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.orderIndex - b.orderIndex || a.title.localeCompare(b.title));
}

/**
 * The resources a student should see for one class, from all three scopes at once.
 *
 * ORDER IS DELIBERATE: the curriculum's own material first (it is the lesson), then anything the
 * cohort was given, then whatever the coach posted for this particular class - which is usually
 * the most recent and most specific, so it reads as an addendum rather than burying the core
 * material under it.
 *
 * Hidden rows never reach here; filtering happens in the query so an unreleased exercise is not
 * merely un-rendered but genuinely not sent to the browser.
 */
export function mergeForSession<T extends SortableResource>(groups: {
  curriculumItem?: readonly T[];
  batch?: readonly T[];
  session?: readonly T[];
}): T[] {
  return [
    ...sortResources(groups.curriculumItem ?? []),
    ...sortResources(groups.batch ?? []),
    ...sortResources(groups.session ?? []),
  ];
}
