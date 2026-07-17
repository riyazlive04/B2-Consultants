import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { istBoundaryToInstant, parseDateInput } from "@/lib/dates";
import { activityKind, activityLabel, type ActivityKind } from "@/lib/activity-actions";

/**
 * The read half of the activity log — the founder's "who did what, when".
 *
 * Every filter is a URL search param rather than client state, so a view of the log is a
 * link: Ameen can bookmark "Asma, pipeline, last Tuesday" or paste it to someone. It also
 * keeps the whole page server-rendered — the table can be thousands of rows without any of
 * them crossing to the browser.
 */

export const ACTIVITY_PAGE_SIZE = 50;

export type ActivityFilters = {
  actorId?: string;
  section?: string;
  action?: string;
  /** IST calendar day, "YYYY-MM-DD", inclusive on both ends. */
  from?: string;
  to?: string;
  /** Free text over the summary — how the founder finds a lead by name. */
  q?: string;
  page: number;
};

export type ActivityRow = {
  id: string;
  at: Date;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  action: string;
  actionLabel: string;
  kind: ActivityKind;
  section: string;
  entityType: string;
  entityId: string;
  summary: string;
  meta: unknown;
};

/** Parse `?…` into filters. Anything unrecognised falls back rather than throwing — a hand-edited URL shows the unfiltered log, never an error page. */
export function parseActivityFilters(sp: Record<string, string | string[] | undefined>): ActivityFilters {
  const one = (v: string | string[] | undefined) => {
    const s = Array.isArray(v) ? v[0] : v;
    const t = s?.trim();
    return t ? t : undefined;
  };
  return {
    actorId: one(sp.actor),
    section: one(sp.section),
    action: one(sp.action),
    from: isDay(one(sp.from)) ? one(sp.from) : undefined,
    to: isDay(one(sp.to)) ? one(sp.to) : undefined,
    q: one(sp.q),
    page: Math.max(1, Number(one(sp.page) ?? 1) || 1),
  };
}

function isDay(v: string | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(parseDateInput(v).getTime());
}

/** True when any filter is narrowing the list — drives the "clear filters" affordance. */
export function hasActiveFilters(f: ActivityFilters): boolean {
  return !!(f.actorId || f.section || f.action || f.from || f.to || f.q);
}

/**
 * An engine (or a token-verified signer) has no user row, so those entries carry a null
 * `actorId` and there is no id to filter on — yet "show me only what the automation did" is
 * a question the founder will absolutely ask. The Who dropdown therefore offers them under a
 * `name:` sentinel, which resolves to a match on the name plus a null actor.
 *
 * The sentinel can't collide with a real value: user ids are cuids and never contain a colon.
 */
const NAME_PREFIX = "name:";

function buildWhere(f: ActivityFilters): Prisma.ActivityLogWhereInput {
  const where: Prisma.ActivityLogWhereInput = {};
  if (f.actorId?.startsWith(NAME_PREFIX)) {
    where.actorId = null;
    where.actorName = f.actorId.slice(NAME_PREFIX.length);
  } else if (f.actorId) {
    where.actorId = f.actorId;
  }
  if (f.section) where.section = f.section;
  if (f.action) where.action = f.action;
  if (f.q) where.summary = { contains: f.q, mode: "insensitive" };

  // `at` is a timestamp, so an IST day boundary has to be converted to the real instant it
  // represents (00:00 IST = 18:30 UTC the day before). Filtering the column with the raw
  // UTC-midnight date would shift the window 5.5h and silently drop everything logged
  // between midnight and 05:30 IST — the graveyard shift would vanish from its own audit.
  if (f.from || f.to) {
    const at: Prisma.DateTimeFilter = {};
    if (f.from) at.gte = istBoundaryToInstant(parseDateInput(f.from));
    if (f.to) {
      // `to` is inclusive: the founder picking 17 Jul means "through the end of 17 Jul".
      const next = parseDateInput(f.to);
      next.setUTCDate(next.getUTCDate() + 1);
      at.lt = istBoundaryToInstant(next);
    }
    where.at = at;
  }
  return where;
}

export async function getActivityPage(f: ActivityFilters): Promise<{
  rows: ActivityRow[];
  total: number;
  pages: number;
}> {
  const where = buildWhere(f);
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      // `at` alone isn't a total order — two actions inside the same millisecond would page
      // nondeterministically and could repeat or skip a row across pages. `id` breaks the tie.
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: ACTIVITY_PAGE_SIZE,
      skip: (f.page - 1) * ACTIVITY_PAGE_SIZE,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return {
    rows: rows.map(toRow),
    total,
    pages: Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE)),
  };
}

/** Row → view model. `actionLabel`/`kind` are derived here so no client has to import the rules. */
function toRow(r: Prisma.ActivityLogGetPayload<object>): ActivityRow {
  return {
    id: r.id,
    at: r.at,
    actorId: r.actorId,
    actorName: r.actorName,
    actorRole: r.actorRole,
    action: r.action,
    actionLabel: activityLabel(r.action),
    kind: activityKind(r.action),
    section: r.section,
    entityType: r.entityType,
    entityId: r.entityId,
    summary: r.summary,
    meta: r.meta,
  };
}

export type ActivityFilterOptions = {
  actors: { value: string; label: string }[];
  sections: { value: string; label: string }[];
  actions: { value: string; label: string }[];
};

/**
 * The filter dropdowns, derived from what is ACTUALLY in the table rather than from a
 * hardcoded catalogue. A hand-kept list would offer filters that match nothing and miss
 * actions nobody remembered to register; this can't drift by construction.
 */
export async function getActivityFilterOptions(): Promise<ActivityFilterOptions> {
  const [actors, sections, actions] = await Promise.all([
    prisma.activityLog.groupBy({
      by: ["actorId", "actorName"],
      _count: { _all: true },
      orderBy: { _count: { actorId: "desc" } },
    }),
    prisma.activityLog.groupBy({ by: ["section"], _count: { _all: true } }),
    prisma.activityLog.groupBy({ by: ["action"], _count: { _all: true } }),
  ]);

  return {
    // Real users filter by id. Engines, signers and departed users have no id, so they filter
    // by name via the sentinel — otherwise the automation's own work would be unfilterable,
    // and a departed telecaller's history would drop out of the Who list entirely.
    actors: actors.map((a) => ({
      value: a.actorId ?? `${NAME_PREFIX}${a.actorName}`,
      label: `${a.actorName} (${a._count._all})`,
    })),
    sections: sections
      .map((s) => ({ value: s.section, label: s.section }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    actions: actions
      .map((a) => ({ value: a.action, label: activityLabel(a.action) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Headline counts for the page's stat row. */
export async function getActivityStats(): Promise<{ today: number; total: number; actors: number }> {
  const startOfTodayIst = istBoundaryToInstant(todayIstBoundary());
  const [today, total, actors] = await Promise.all([
    prisma.activityLog.count({ where: { at: { gte: startOfTodayIst } } }),
    prisma.activityLog.count(),
    prisma.activityLog.findMany({
      where: { at: { gte: startOfTodayIst } },
      distinct: ["actorId"],
      select: { actorId: true },
    }),
  ]);
  return { today, total, actors: actors.length };
}

function todayIstBoundary(): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * The trail for ONE record — "everything that ever happened to this lead", newest first.
 * Not wired into a screen yet; it's the query the entity drawers will want, and it exists
 * here so the `[entityType, entityId]` index has its intended reader.
 */
export async function getEntityActivity(entityType: string, entityId: string, take = 20): Promise<ActivityRow[]> {
  const rows = await prisma.activityLog.findMany({
    where: { entityType, entityId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take,
  });
  return rows.map(toRow);
}
