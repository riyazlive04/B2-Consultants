import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import {
  IMPROVEMENT_KINDS,
  IMPROVEMENT_SEVERITIES,
  IMPROVEMENT_STATUSES,
  isOpenStatus,
  type Breadcrumb,
  type ElementTag,
  type ImprovementEventKind,
  type ImprovementKind,
  type ImprovementSeverity,
  type ImprovementStatus,
} from "@/lib/improvement";
import type { ImprovementContext } from "./improvement-context";

/**
 * READS for the triage queue.
 *
 * Separate from `improvement-actions.ts` for the house reason: that file is `"use server"`, so every
 * export in it is a callable endpoint. A read helper does not want to be one, and putting it
 * there would mint an action id for each.
 *
 * ── Archived rows are filtered in EVERY query here ─────────────────────────────────────────
 * `...ACTIVE`, explicitly, per query - the house pattern, no middleware. The one place that
 * deliberately sees archived rows is the archive list itself.
 */

export const PAGE_SIZE = 25;

export type ImprovementFilters = {
  status: ImprovementStatus | "OPEN" | "ALL";
  kind: ImprovementKind | null;
  severity: ImprovementSeverity | null;
  section: string | null;
  reporterId: string | null;
  /** A ref, so a link out of a notification email lands on the report it names. */
  ref: string | null;
  page: number;
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

export function parseImprovementFilters(sp: SP): ImprovementFilters {
  const status = one(sp.status);
  const kind = one(sp.kind);
  const severity = one(sp.severity);
  const page = Number(one(sp.page) ?? 1);
  return {
    // OPEN is the default view. A queue that opens on every report ever filed is a list, not a
    // queue - the question somebody opens this screen to answer is "what is waiting for me".
    status:
      status === "ALL"
        ? "ALL"
        : status && (IMPROVEMENT_STATUSES as readonly string[]).includes(status)
          ? (status as ImprovementStatus)
          : "OPEN",
    kind: kind && (IMPROVEMENT_KINDS as readonly string[]).includes(kind) ? (kind as ImprovementKind) : null,
    severity:
      severity && (IMPROVEMENT_SEVERITIES as readonly string[]).includes(severity)
        ? (severity as ImprovementSeverity)
        : null,
    section: one(sp.section) ?? null,
    reporterId: one(sp.reporter) ?? null,
    ref: one(sp.ref)?.toUpperCase() ?? null,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

export function hasActiveImprovementFilters(f: ImprovementFilters): boolean {
  return Boolean(f.kind || f.severity || f.section || f.reporterId || f.ref || f.status !== "OPEN");
}

const OPEN_STATUSES = IMPROVEMENT_STATUSES.filter(isOpenStatus);

function where(f: ImprovementFilters) {
  return {
    ...ACTIVE,
    ...(f.status === "ALL" ? {} : f.status === "OPEN" ? { status: { in: OPEN_STATUSES } } : { status: f.status }),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.section ? { sectionKey: f.section } : {}),
    ...(f.reporterId ? { reporterId: f.reporterId } : {}),
    ...(f.ref ? { ref: f.ref } : {}),
  };
}

export type ImprovementRow = {
  id: string;
  ref: string;
  kind: ImprovementKind;
  severity: ImprovementSeverity;
  status: ImprovementStatus;
  title: string;
  route: string;
  sectionKey: string | null;
  reporterName: string;
  reporterRole: string;
  assigneeName: string | null;
  /** Non-empty means the screen's engine was off when this was filed - shown as a chip in the row. */
  enginesOff: string[];
  /** The attached recording, or null. Drives the chip telling triage there is something to watch. */
  recording: { kind: "AUDIO" | "SCREEN"; seconds: number } | null;
  /** Escalated by the head coach or the founder. Sorts to the top of the queue. */
  urgent: boolean;
  createdAt: Date;
  events: number;
};

export async function getImprovementPage(f: ImprovementFilters): Promise<{
  rows: ImprovementRow[];
  total: number;
  pages: number;
}> {
  const w = where(f);
  const [total, found] = await Promise.all([
    prisma.improvement.count({ where: w }),
    prisma.improvement.findMany({
      where: w,
      /**
        * URGENT FIRST, then newest.
        *
        * This is the only thing escalation does, and it is deliberately an ORDERING and not a
        * status change: an escalated report is still New or Accepted or In progress, and its
        * severity is still whatever the reporter honestly said. The head coach moves it up the
        * page; they do not reach into the triage state.
        */
      orderBy: [{ urgent: "desc" }, { createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        ref: true,
        kind: true,
        severity: true,
        status: true,
        title: true,
        route: true,
        sectionKey: true,
        createdAt: true,
        context: true,
        urgent: true,
        reporterRole: true,
        reporter: { select: { name: true } },
        assignee: { select: { name: true } },
        recording: { select: { kind: true, seconds: true } },
        _count: { select: { events: true } },
      },
    }),
  ]);

  return {
    rows: found.map((r) => ({
      id: r.id,
      ref: r.ref,
      kind: r.kind as ImprovementKind,
      severity: r.severity as ImprovementSeverity,
      status: r.status as ImprovementStatus,
      title: r.title,
      route: r.route,
      sectionKey: r.sectionKey,
      reporterName: r.reporter.name,
      reporterRole: r.reporterRole,
      assigneeName: r.assignee?.name ?? null,
      enginesOff: enginesOffFrom(r.context),
      recording: r.recording ? { kind: r.recording.kind, seconds: r.recording.seconds } : null,
      urgent: r.urgent,
      createdAt: r.createdAt,
      events: r._count.events,
    })),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/**
 * The arming verdict, pulled out of the stored context for the list row.
 *
 * Defensive about the shape on purpose: `context` is a JSON column written by whatever version of
 * the capture code was running at the time, and a report filed last month must still render in a
 * queue today. Anything unreadable reads as "no engines off", never as a crash - the triage
 * screen going blank because one old row has a different shape would be a worse bug than the one
 * being reported.
 */
function enginesOffFrom(context: unknown): string[] {
  if (!context || typeof context !== "object") return [];
  const list = (context as { enginesOff?: unknown }).enginesOff;
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => (e && typeof e === "object" ? String((e as { name?: unknown }).name ?? "") : ""))
    .filter(Boolean);
}

export type ImprovementEventView = {
  id: string;
  kind: ImprovementEventKind;
  fromValue: string | null;
  toValue: string | null;
  body: string | null;
  visibleToReporter: boolean;
  actorName: string;
  createdAt: Date;
};

export type ImprovementDetail = {
  id: string;
  ref: string;
  kind: ImprovementKind;
  severity: ImprovementSeverity;
  status: ImprovementStatus;
  title: string;
  answers: Record<string, string>;
  reporterNote: string | null;
  /** The attached recording, or null. The BYTES are never loaded here - only its shape. */
  recording: { kind: "AUDIO" | "SCREEN"; seconds: number; hasAudio: boolean } | null;
  /** Escalated by the head coach or the founder. */
  urgent: boolean;
  route: string;
  routeParams: Record<string, string> | null;
  sectionKey: string | null;
  elementTag: ElementTag | null;
  breadcrumbs: Breadcrumb[];
  context: ImprovementContext | null;
  clientDigest: string | null;
  appVersion: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  reporterName: string;
  reporterRole: string;
  assigneeName: string | null;
  duplicateOfRef: string | null;
  devNote: string | null;
  resolution: string | null;
  notifiedAt: Date | null;
  firstTriagedAt: Date | null;
  createdAt: Date;
  events: ImprovementEventView[];
};

export async function getImprovementDetail(id: string): Promise<ImprovementDetail | null> {
  const r = await prisma.improvement.findFirst({
    where: { id, ...ACTIVE },
    select: {
      id: true,
      ref: true,
      kind: true,
      severity: true,
      status: true,
      title: true,
      answers: true,
      reporterNote: true,
      // SHAPE ONLY, never `bytes`. Selecting them here would pull up to 25 MB of video into the
      // page render for a player that fetches it from its own route anyway.
      recording: { select: { kind: true, seconds: true, hasAudio: true } },
      route: true,
      routeParams: true,
      sectionKey: true,
      elementTag: true,
      breadcrumbs: true,
      context: true,
      clientDigest: true,
      appVersion: true,
      screenWidth: true,
      screenHeight: true,
      urgent: true,
      reporterRole: true,
      devNote: true,
      resolution: true,
      notifiedAt: true,
      firstTriagedAt: true,
      createdAt: true,
      reporter: { select: { name: true } },
      assignee: { select: { name: true } },
      duplicateOf: { select: { ref: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          fromValue: true,
          toValue: true,
          body: true,
          visibleToReporter: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      },
    },
  });
  if (!r) return null;

  return {
    id: r.id,
    ref: r.ref,
    kind: r.kind as ImprovementKind,
    severity: r.severity as ImprovementSeverity,
    status: r.status as ImprovementStatus,
    title: r.title,
    answers: asStringRecord(r.answers),
    reporterNote: r.reporterNote,
    recording: r.recording
      ? { kind: r.recording.kind, seconds: r.recording.seconds, hasAudio: r.recording.hasAudio }
      : null,
    urgent: r.urgent,
    route: r.route,
    routeParams: r.routeParams ? asStringRecord(r.routeParams) : null,
    sectionKey: r.sectionKey,
    elementTag: (r.elementTag as ElementTag | null) ?? null,
    breadcrumbs: Array.isArray(r.breadcrumbs) ? (r.breadcrumbs as unknown as Breadcrumb[]) : [],
    context: (r.context as unknown as ImprovementContext | null) ?? null,
    clientDigest: r.clientDigest,
    appVersion: r.appVersion,
    screenWidth: r.screenWidth,
    screenHeight: r.screenHeight,
    reporterName: r.reporter.name,
    reporterRole: r.reporterRole,
    assigneeName: r.assignee?.name ?? null,
    duplicateOfRef: r.duplicateOf?.ref ?? null,
    devNote: r.devNote,
    resolution: r.resolution,
    notifiedAt: r.notifiedAt,
    firstTriagedAt: r.firstTriagedAt,
    createdAt: r.createdAt,
    events: r.events.map((e) => ({
      id: e.id,
      kind: e.kind as ImprovementEventKind,
      fromValue: e.fromValue,
      toValue: e.toValue,
      body: e.body,
      visibleToReporter: e.visibleToReporter,
      actorName: e.actor.name,
      createdAt: e.createdAt,
    })),
  };
}

/** A JSON column read back as the string map it was written as, tolerating anything else. */
function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export type ImprovementStats = {
  open: number;
  untriaged: number;
  blocking: number;
  /** Reports whose screen had a disarmed engine - usually not bugs at all. */
  engineOff: number;
  total: number;
};

/**
 * The four numbers at the top of the queue.
 *
 * `engineOff` earns its place: it is the count of reports that are probably answered already, and
 * seeing it beside the untriaged count is what stops a developer working through six reports of
 * "this section does nothing" one at a time.
 */
export async function getImprovementStats(): Promise<ImprovementStats> {
  const [open, untriaged, blocking, total, recent] = await Promise.all([
    prisma.improvement.count({ where: { ...ACTIVE, status: { in: OPEN_STATUSES } } }),
    prisma.improvement.count({ where: { ...ACTIVE, status: "NEW" } }),
    prisma.improvement.count({
      where: { ...ACTIVE, severity: "BLOCKING", status: { in: OPEN_STATUSES } },
    }),
    prisma.improvement.count({ where: ACTIVE }),
    // Counting a JSON array's emptiness is not something Prisma can express portably, so the open
    // rows' contexts are read and counted here. Bounded by the open queue, which is small by
    // construction - if it ever is not, that is the problem, not this query.
    prisma.improvement.findMany({
      where: { ...ACTIVE, status: { in: OPEN_STATUSES } },
      select: { context: true },
      take: 200,
    }),
  ]);
  return {
    open,
    untriaged,
    blocking,
    engineOff: recent.filter((r) => enginesOffFrom(r.context).length > 0).length,
    total,
  };
}

/**
 * The two counts the notification bell needs, and nothing else.
 *
 * Deliberately NOT `getImprovementStats()`: that runs five queries including a 200-row read, which is
 * the right price for the top of the queue screen and the wrong one for a badge that renders on
 * every page in the app. The shell's widgets are the slowest thing in it already - the runway and
 * the bell each had to be moved behind their own Suspense boundary for exactly this reason.
 */
export async function getImprovementBellCounts(): Promise<{ untriaged: number; blocking: number }> {
  const [untriaged, blocking] = await Promise.all([
    prisma.improvement.count({ where: { ...ACTIVE, status: "NEW" } }),
    prisma.improvement.count({
      where: { ...ACTIVE, severity: "BLOCKING", status: { in: OPEN_STATUSES } },
    }),
  ]);
  return { untriaged, blocking };
}

/** Which sections generate reports, most first - the evidence for where work should go next. */
export async function getImprovementSectionTally(): Promise<{ sectionKey: string | null; count: number }[]> {
  const rows = await prisma.improvement.groupBy({
    by: ["sectionKey"],
    where: { ...ACTIVE, status: { in: OPEN_STATUSES } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ sectionKey: r.sectionKey, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

/** The people who have filed something, for the reporter filter. */
export async function getImprovementReporters(): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.improvement.findMany({
    where: ACTIVE,
    distinct: ["reporterId"],
    select: { reporterId: true, reporter: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  return rows.map((r) => ({ id: r.reporterId, name: r.reporter.name }));
}

/**
 * Reports filed since `since`, for the daily digest.
 *
 * `notifiedAt: null` is the filter that matters: a BLOCKING report that already triggered its own
 * email is not repeated in the digest. Nobody needs to be told twice, and a digest that repeats
 * what you have already read is a digest you stop opening.
 */
export async function getImprovementsForDigest(since: Date) {
  return prisma.improvement.findMany({
    where: { ...ACTIVE, createdAt: { gte: since }, notifiedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      ref: true,
      kind: true,
      severity: true,
      title: true,
      route: true,
      context: true,
      reporter: { select: { name: true } },
    },
    take: 50,
  });
}
