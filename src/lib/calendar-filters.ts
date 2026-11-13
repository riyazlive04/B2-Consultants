/**
 * What the Manage view panel is showing, read from and written to the URL.
 *
 * Pure, so the server page and the panel agree on one reading of `?users`, `?off`, `?cal` and
 * `?type`, and a shared link always opens the same view.
 *
 * ── Why two ways of saying who ─────────────────────────────────────────────────────────────
 * A 22-person team makes "everyone except Anna" 21 ids long, and that lands in the address bar
 * on the FIRST untick. So the choice is written whichever way round is shorter: `users` lists
 * who to show, `off` lists who to hide, and the server understands both. The reader sees
 * `?off=<one id>` for the common case instead of a paragraph of ids.
 */

import type { CalEvent, CalType } from "./calendar-event";

export type ViewType = "all" | "appointments" | "blocked";

export type CalFilters = {
  /** Owner ids to show; `""` is the unassigned pile. `null` = not narrowed this way. */
  users: string[] | null;
  /** Owner ids to hide. `null` = none hidden. Only one of `users`/`usersOff` is ever set. */
  usersOff: string[] | null;
  /** Which call types to show; `null` = both (the default). */
  cals: CalType[] | null;
  type: ViewType;
};

export const DEFAULT_FILTERS: CalFilters = { users: null, usersOff: null, cals: null, type: "all" };

const VIEW_TYPES: ViewType[] = ["all", "appointments", "blocked"];
/**
 * The unassigned pile is the empty owner id, which cannot travel in a URL as itself: `?users=`
 * would then mean both "only unassigned" and "nobody at all". It gets a word of its own.
 */
const UNASSIGNED = "none";
const decode = (v: string) => (v === UNASSIGNED ? "" : v);
const encode = (v: string) => (v === "" ? UNASSIGNED : v);

const list = (v: string | undefined) =>
  v === undefined
    ? null
    : v.split(",").map((s) => s.trim()).filter((s) => s !== "").filter((s, i, a) => a.indexOf(s) === i);

export function parseFilters(params: { users?: string; off?: string; cal?: string; type?: string }): CalFilters {
  const cals = list(params.cal)?.filter((c): c is CalType => c === "DISCO" || c === "SSS") ?? null;
  const users = list(params.users)?.map(decode) ?? null;
  return {
    // An empty `?users=` means "nothing ticked", which is a real state and must stay empty -
    // falling back to everyone there would re-show what the reader just unticked.
    users,
    // `off` is ignored when `users` is present: an explicit list already says everything.
    usersOff: users !== null ? null : (list(params.off)?.map(decode) ?? null),
    cals: cals && cals.length ? cals : params.cal === undefined ? null : [],
    type: VIEW_TYPES.includes(params.type as ViewType) ? (params.type as ViewType) : "all",
  };
}

/** The URL parameters for a set of filters; a default is left out rather than spelled out. */
export function filterParams(f: CalFilters): Record<string, string | null> {
  return {
    users: f.users === null ? null : f.users.map(encode).join(","),
    off: f.usersOff === null || f.usersOff.length === 0 ? null : f.usersOff.map(encode).join(","),
    cal: f.cals === null ? null : f.cals.join(","),
    type: f.type === "all" ? null : f.type,
  };
}

/** Is this person drawn? */
export const userShown = (f: CalFilters, id: string) =>
  f.users !== null ? f.users.includes(id) : !(f.usersOff ?? []).includes(id);

/**
 * Tick or untick one person, then store the choice whichever way round is shorter.
 * `allIds` is every pickable owner, including `""` for the unassigned pile.
 */
export function toggleUser(f: CalFilters, id: string, allIds: string[]): CalFilters {
  const shown = allIds.filter((u) => userShown(f, u));
  const next = shown.includes(id) ? shown.filter((u) => u !== id) : [...shown, id];
  const hidden = allIds.filter((u) => !next.includes(u));
  if (hidden.length === 0) return { ...f, users: null, usersOff: null };
  // A tie goes to `off`, which keeps "all but one" - the common case - the short one.
  return next.length < hidden.length
    ? { ...f, users: next, usersOff: null }
    : { ...f, users: null, usersOff: hidden };
}

export const toggleCal = (f: CalFilters, c: CalType): CalFilters => {
  const base = f.cals ?? (["DISCO", "SSS"] as CalType[]);
  return { ...f, cals: base.includes(c) ? base.filter((x) => x !== c) : [...base, c] };
};

export const kindsFor = (t: ViewType): CalEvent["kind"][] | undefined =>
  t === "appointments" ? ["APPOINTMENT"] : t === "blocked" ? ["BLOCKED"] : undefined;

/** True when the filters would hide everything, so the grid can say why it is empty. */
export const showsNothing = (f: CalFilters) =>
  (f.users !== null && f.users.length === 0) || (f.cals !== null && f.cals.length === 0);

export const isDefaultFilters = (f: CalFilters) =>
  f.users === null && (f.usersOff === null || f.usersOff.length === 0) && f.cals === null && f.type === "all";
