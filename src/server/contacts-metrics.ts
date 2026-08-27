import "server-only";

import { Prisma, LeadStage, LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatInrMinor, formatEurMinor } from "@/lib/format";
import { resolveBant, type BantSnapshot } from "@/lib/bant-view";
import { ACTIVE } from "@/lib/soft-delete";
import { WHATSAPP_KIND_LABELS } from "@/lib/whatsapp";

/**
 * Read layer for the Synamate-parity Contacts CRM (SYNAMATE_CLONE_SPEC §5).
 * The Lead IS the Contact. Everything returned here is already serializable
 * (no BigInt) so it can cross into the client tables/record view.
 */

export type ContactRow = {
  id: string;
  name: string;
  /** Null since the Synamate import - thousands of contacts arrived with an email but no number. */
  phone: string | null;
  email: string | null;
  company: string | null;
  ownerName: string | null;
  stage: string;
  tags: { id: string; name: string; color: string | null }[];
  openOpps: number;
  createdAt: Date;
  lastActivityAt: Date;
};

export type ContactListFilters = {
  tags: { id: string; name: string; color: string | null; count: number }[];
  owners: { id: string; name: string; image: string | null }[];
  companies: { id: string; name: string }[];
  total: number;
};

// A real page size, not a silent-truncation cap: every row beyond this is still reachable via
// nextCursor - nothing is ever dropped on the floor the way the old LIST_CAP=1000 dropped row
// 1001+ with no way to reach it. BUILD_CHECKLIST.md §3.
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export type ContactsListOpts = {
  search?: string;
  tagId?: string;
  ownerId?: string;
  /** Raw strings from the URL - validated against the real enum before use, invalid/unknown
   *  values are just ignored rather than throwing (a stale bookmark shouldn't 500 the page). */
  stage?: string;
  source?: string;
  city?: string;
  /** ISO yyyy-mm-dd, inclusive on both ends, matched against `createdAt`. */
  dateFrom?: string;
  dateTo?: string;
  /** Keyset cursor: the id of the last row already shown. Omit for page 1. */
  cursor?: string;
  take?: number;
};

export type ContactsListResult = {
  rows: ContactRow[];
  /** Id to pass as `cursor` for the next page, or null if this is the last page. */
  nextCursor: string | null;
  hasMore: boolean;
  /** Count of rows matching the current filters (not the whole table) - powers the
   *  "Showing X–Y of Z" pagination notice. */
  filteredTotal: number;
};

function asEnum<T extends string>(value: string | undefined, all: readonly T[]): T | undefined {
  return value && (all as readonly string[]).includes(value) ? (value as T) : undefined;
}

function dateRangeFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (from) {
    const d = new Date(from);
    if (!isNaN(d.getTime())) filter.gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(23, 59, 59, 999); // inclusive of the whole "to" day
      filter.lte = d;
    }
  }
  return Object.keys(filter).length ? filter : undefined;
}

/**
 * Exported so the CSV export route can run the EXACT SAME predicate the screen ran.
 *
 * This is the whole point of the export API: the previous export was a client-side dump of the
 * rows already on screen, so "download all leads for July" produced whatever subset of July had
 * fitted in the current page. Sharing the `where` builder is what makes the file and the screen
 * describe the same set - and keeps them describing the same set when a filter is added later.
 */
export function contactsWhere(opts: ContactsListOpts): Prisma.LeadWhereInput {
  const search = opts.search?.trim();
  const city = opts.city?.trim();
  const stage = asEnum(opts.stage, Object.values(LeadStage));
  const source = asEnum(opts.source, Object.values(LeadSource));
  const createdAt = dateRangeFilter(opts.dateFrom, opts.dateTo);

  return {
    ...ACTIVE, // exclude archived contacts from every list/count that shares this where
    ...(opts.tagId ? { tags: { some: { id: opts.tagId } } } : {}),
    ...(opts.ownerId ? { assignedToId: opts.ownerId } : {}),
    ...(stage ? { stage } : {}),
    ...(source ? { leadSource: source } : {}),
    ...(city ? { city: { contains: city, mode: "insensitive" } } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

const CONTACT_ROW_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  stage: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { name: true } },
  assignedTo: { select: { name: true } },
  tags: { select: { id: true, name: true, color: true } },
  _count: { select: { opportunities: { where: { status: "OPEN", deletedAt: null } } } },
} satisfies Prisma.LeadSelect;

function toContactRow(l: Prisma.LeadGetPayload<{ select: typeof CONTACT_ROW_SELECT }>): ContactRow {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    company: l.company?.name ?? null,
    ownerName: l.assignedTo?.name ?? null,
    stage: l.stage,
    tags: l.tags,
    openOpps: l._count.opportunities,
    createdAt: l.createdAt,
    lastActivityAt: l.updatedAt,
  };
}

/**
 * Contacts list, newest first, filtered server-side (search text / tag / owner / stage / source /
 * city / date range) and paginated with a real keyset cursor - replaces the old LIST_CAP=1000
 * flat dump. Ordered by `createdAt desc, id desc` so the cursor (on the unique `id`) is stable
 * even when many leads share a `createdAt`.
 */
export async function getContactsList(opts: ContactsListOpts): Promise<ContactsListResult> {
  const take = Math.min(Math.max(opts.take ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const where = contactsWhere(opts);

  const findPage = (cursor?: string) =>
    prisma.lead.findMany({
      where,
      select: CONTACT_ROW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1, // fetch one extra row to detect "more pages exist" without a second query
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

  const [leads, filteredTotal] = await Promise.all([
    // A bookmarked/shared `?cursor=` can go stale (that contact was since deleted) - Prisma
    // throws on a cursor row that no longer exists. Falling back to page 1 beats a 500 for
    // what's really just an expired link. Any other failure (e.g. a real DB error) still
    // propagates - only a cursor lookup gets a retry.
    findPage(opts.cursor).catch((err) => {
      if (!opts.cursor) throw err;
      return findPage(undefined);
    }),
    prisma.lead.count({ where }),
  ]);

  const hasMore = leads.length > take;
  const pageLeads = hasMore ? leads.slice(0, take) : leads;

  return {
    rows: pageLeads.map(toContactRow),
    nextCursor: hasMore ? pageLeads[pageLeads.length - 1].id : null,
    hasMore,
    filteredTotal,
  };
}

export async function getContactListFilters(): Promise<ContactListFilters> {
  const [tags, owners, companies, total] = await Promise.all([
    prisma.tag.findMany({
      select: { id: true, name: true, color: true, _count: { select: { leads: { where: ACTIVE } } } },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, image: true },
      orderBy: { name: "asc" },
    }),
    prisma.company.findMany({ where: ACTIVE, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.lead.count({ where: ACTIVE }),
  ]);
  return {
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.leads })),
    owners,
    companies,
    total,
  };
}

// ─────────────────────────── Contact record ───────────────────────────

export type TimelineEvent = {
  id: string;
  /**
   * `CALL` is every logged dial - the one thing this timeline never showed.
   *
   * Its absence was strange rather than deliberate: the empty state has always promised "notes,
   * CALLS, messages, stage changes and appointments", and calls were the only one of the five
   * missing. It matters more now that the call-back chase runs off exactly these rows - a card
   * that says "moved to Cancelled/Unqualified" with no visible reason invites the question this
   * timeline exists to answer, and the answer is the three call-backs above it.
   */
  kind: "NOTE" | "STAGE_CHANGE" | "WHATSAPP" | "OUTCOME" | "BOOKING" | "TASK" | "CALL";
  at: Date;
  title: string;
  body: string | null;
  authorName: string | null;
  tone: "neutral" | "primary" | "good" | "warn" | "bad" | "info";
};

export type ContactDetail = {
  id: string;
  name: string;
  /** Null since the Synamate import - see ContactRow.phone. */
  phone: string | null;
  email: string | null;
  city: string | null;
  industry: string | null;
  leadSource: string;
  stage: string;
  notes: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: Date;
  contactedAt: Date | null;
  tags: { id: string; name: string; color: string | null }[];
  customFields: Record<string, unknown>;
  noteList: { id: string; body: string; pinned: boolean; authorName: string | null; createdAt: Date }[];
  taskList: {
    id: string;
    title: string;
    body: string | null;
    dueAt: Date | null;
    status: string;
    assigneeName: string | null;
  }[];
  opportunities: {
    id: string;
    name: string;
    stageName: string;
    pipelineName: string;
    status: string;
    valueDisplay: string;
  }[];
  /**
   * The resolved band score, or null for "not scored".
   *
   * NULL IS NOT ZERO. An unscored prospect is one nobody has evidence about; rendering them as
   * 0.0/5 beside genuinely poor prospects is how a good lead gets deprioritised for never having
   * been asked. See lib/bant-view.ts.
   */
  bant: BantSnapshot | null;
  bantScoredAt: Date | null;
  /** The individual answers behind the score, in the order the form asked them. */
  answers: { question: string; dimension: string; answer: string; score: number | null }[];
  timeline: TimelineEvent[];
};

export async function getContactDetail(id: string): Promise<ContactDetail | null> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
      contactNotes: {
        include: { createdBy: { select: { name: true } } },
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      },
      tasks: {
        where: ACTIVE,
        include: { assignedTo: { select: { name: true } } },
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      },
      opportunities: {
        where: ACTIVE,
        include: { stage: { select: { name: true } }, pipeline: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      stageHistory: {
        include: { changedBy: { select: { name: true } } },
        orderBy: { changedAt: "desc" },
        take: 100,
      },
      whatsappMessages: { orderBy: { createdAt: "desc" }, take: 100 },
      /**
       * Every dial, oldest first.
       *
       * ASCENDING deliberately, unlike its neighbours: the call-back round each row belongs to is
       * its POSITION in the sequence, so the numbering has to be computed forwards even though
       * the timeline is finally sorted newest-first.
       */
      callLogs: {
        include: { user: { select: { name: true } } },
        orderBy: { calledAt: "asc" },
        take: 100,
      },
      outcomes: { orderBy: { callDate: "desc" }, take: 50 },
      bookings: { include: { slot: { select: { startsAt: true } } }, orderBy: { createdAt: "desc" }, take: 50 },
      /**
       * The stored answers behind the band score - ER v2 Track D's `LeadAnswer` rows.
       *
       * Pinned to the QUESTION VERSION that was answered, so re-tuning a question later cannot
       * rewrite the reason this person was called. Ordered by the catalogue's own order so the
       * record reads like the form they filled in.
       */
      answers: {
        where: { bookingRequestId: null },
        include: { question: { select: { key: true, text: true, dimension: true, orderIndex: true } } },
        orderBy: { question: { orderIndex: "asc" } },
        take: 40,
      },
    },
  });
  if (!lead) return null;

  // Build the merged activity timeline (newest first).
  const timeline: TimelineEvent[] = [];
  for (const n of lead.contactNotes) {
    timeline.push({
      id: `note-${n.id}`,
      kind: "NOTE",
      at: n.createdAt,
      title: n.pinned ? "Pinned note" : "Note",
      body: n.body,
      authorName: n.createdBy?.name ?? null,
      tone: "neutral",
    });
  }
  for (const h of lead.stageHistory) {
    timeline.push({
      id: `stage-${h.id}`,
      kind: "STAGE_CHANGE",
      at: h.changedAt,
      title: h.fromStage ? `Stage: ${prettyStage(h.fromStage)} → ${prettyStage(h.toStage)}` : `Entered as ${prettyStage(h.toStage)}`,
      body: null,
      authorName: h.changedBy?.name ?? null,
      tone: h.toStage === "WON" ? "good" : h.toStage === "LOST" || h.toStage === "NO_SHOW" ? "bad" : "info",
    });
  }
  for (const w of lead.whatsappMessages) {
    timeline.push({
      id: `wa-${w.id}`,
      kind: "WHATSAPP",
      at: w.createdAt,
      // The touchpoint's NAME, not its enum constant. "SOP 7b · Second follow-up, still not
      // booked" tells the reader what the prospect received; "SOP_FOLLOWUP_2" makes them go and
      // look it up, which on a record meant to explain a decision is the whole cost.
      // The VERB reports the outcome, not the attempt. Ten failed pre-call reminders all read
      // "WhatsApp sent" here while the prospect received nothing - the founder reasonably read
      // the card as proof of delivery and asked why the messages never arrived. The red tone
      // below always said otherwise, but nobody reads a colour over a sentence.
      title: `WhatsApp ${
        w.direction === "INBOUND"
          ? "received"
          : w.status === "FAILED"
            ? "FAILED"
            : w.status === "SKIPPED"
              ? "skipped"
              : "sent"
      }${w.kind ? ` · ${WHATSAPP_KIND_LABELS[w.kind] ?? w.kind}` : ""}`,
      // A skipped or failed send has a written reason and no body. Showing the reason is the
      // point: "nothing went out because no template is bound" must not look like silence.
      body: w.body ?? w.error ?? null,
      authorName: null,
      tone:
        w.status === "FAILED"
          ? "bad"
          : w.status === "SKIPPED"
            ? "warn"
            : w.direction === "INBOUND"
              ? "good"
              : "primary",
    });
  }

  /**
   * The dials, numbered the way the call-back chase numbers them.
   *
   * The first CONNECTED call opens the chase, and everything after it is a call-back - so the
   * labels here are the same sequence the caller saw on their desk ("Call-back 2 of 3") and the
   * same one the give-up entry counts. Anything before the first connection is an attempt, not a
   * call-back, and is labelled as such rather than being given a round number it never had.
   *
   * Kept in step with `lib/callback-chase.ts` by construction: both count dials after the first
   * SPOKE, and both treat a dial that rang out as a real attempt.
   */
  const firstSpokeIdx = lead.callLogs.findIndex((c) => c.outcome === "SPOKE");
  lead.callLogs.forEach((c, i) => {
    const outcome = c.outcome.replaceAll("_", " ").toLowerCase();
    const label =
      firstSpokeIdx === -1 || i < firstSpokeIdx
        ? `Call attempt ${i + 1}`
        : i === firstSpokeIdx
          ? "Call - first connected"
          : `Call-back ${i - firstSpokeIdx}`;
    timeline.push({
      id: `call-${c.id}`,
      kind: "CALL",
      at: c.calledAt,
      title: `${label} · ${outcome}`,
      body: c.notes ?? null,
      authorName: c.user?.name ?? null,
      tone:
        c.outcome === "SPOKE"
          ? "good"
          : c.outcome === "NOT_INTERESTED" || c.outcome === "WRONG_NUMBER"
            ? "bad"
            : "neutral",
    });
  });
  for (const o of lead.outcomes) {
    timeline.push({
      id: `outcome-${o.id}`,
      kind: "OUTCOME",
      at: o.callDate,
      title: `Discovery call · ${o.outcome.replaceAll("_", " ").toLowerCase()}`,
      body: o.notes ?? null,
      authorName: null,
      tone: o.highlyQualified ? "good" : "neutral",
    });
  }
  for (const b of lead.bookings) {
    timeline.push({
      id: `booking-${b.id}`,
      kind: "BOOKING",
      at: b.slot?.startsAt ?? b.createdAt,
      title: `Appointment ${b.status.toLowerCase()}`,
      body: null,
      authorName: null,
      tone: b.status === "CANCELLED" || b.status === "NO_SHOW" ? "warn" : "primary",
    });
  }
  for (const t of lead.tasks) {
    if (t.status === "COMPLETED" && t.completedAt) {
      timeline.push({
        id: `task-${t.id}`,
        kind: "TASK",
        at: t.completedAt,
        title: `Task completed: ${t.title}`,
        body: t.body ?? null,
        authorName: t.assignedTo?.name ?? null,
        tone: "good",
      });
    }
  }
  timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    industry: lead.industry,
    leadSource: lead.leadSource,
    stage: lead.stage,
    notes: lead.notes,
    companyId: lead.companyId,
    companyName: lead.company?.name ?? null,
    ownerId: lead.assignedTo?.id ?? null,
    ownerName: lead.assignedTo?.name ?? null,
    createdAt: lead.createdAt,
    contactedAt: lead.contactedAt,
    tags: lead.tags,
    customFields: (lead.customFields as Record<string, unknown> | null) ?? {},
    noteList: lead.contactNotes.map((n) => ({
      id: n.id,
      body: n.body,
      pinned: n.pinned,
      authorName: n.createdBy?.name ?? null,
      createdAt: n.createdAt,
    })),
    taskList: lead.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      dueAt: t.dueAt,
      status: t.status,
      assigneeName: t.assignedTo?.name ?? null,
    })),
    opportunities: lead.opportunities.map((o) => ({
      id: o.id,
      name: o.name,
      stageName: o.stage.name,
      pipelineName: o.pipeline.name,
      status: o.status,
      valueDisplay: `${formatInrMinor(o.valueInrMinor)} · ${formatEurMinor(o.valueEurMinor)}`,
    })),
    /**
     * The band score, resolved by the app's single rule - the BOOKING's score where one exists,
     * otherwise the LEAD's own (the landing page's answers, taken at opt-in).
     *
     * This screen showed no score at all. It is the "client section" a specialist opens before a
     * call, and the landing page had been collecting these answers the whole time - so the one
     * place the score was most useful was the one place it never appeared.
     *
     * Null means NOT SCORED, and the UI must render it as that, never as zero.
     */
    bant: resolveBant(
      lead.bookings.find((b) => b.bantAvg !== null) ?? null,
      lead,
    ),
    bantScoredAt: lead.bantScoredAt,
    answers: lead.answers.map((a) => ({
      question: a.question.text,
      dimension: a.question.dimension,
      answer: a.answerRaw,
      score: a.score,
    })),
    timeline,
  };
}

function prettyStage(s: string): string {
  return s
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─────────────────────────── Custom fields & companies (shared reads) ───────────────────────────

export async function getContactCustomFields() {
  return prisma.customFieldDefinition.findMany({
    where: { object: "CONTACT" },
    orderBy: { position: "asc" },
  });
}

export async function getCompaniesList() {
  const companies = await prisma.company.findMany({
    where: ACTIVE,
    include: {
      owner: { select: { name: true } },
      _count: { select: { leads: { where: ACTIVE } } },
    },
    orderBy: { name: "asc" },
  });
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    phone: c.phone,
    email: c.email,
    city: c.city,
    country: c.country,
    ownerName: c.owner?.name ?? null,
    contactCount: c._count.leads,
    createdAt: c.createdAt,
  }));
}

export async function getTasksList(opts: { status?: "OPEN" | "COMPLETED" }) {
  const tasks = await prisma.contactTask.findMany({
    where: {
      ...ACTIVE, // not archived
      ...(opts.status ? { status: opts.status } : {}),
      // Hide tasks whose parent contact is archived; standalone tasks (no lead) still show.
      OR: [{ leadId: null }, { lead: { deletedAt: null } }],
    },
    include: {
      assignedTo: { select: { name: true } },
      lead: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 500,
  });
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    body: t.body,
    dueAt: t.dueAt,
    status: t.status,
    assigneeName: t.assignedTo?.name ?? null,
    contactId: t.lead?.id ?? null,
    contactName: t.lead?.name ?? null,
  }));
}
