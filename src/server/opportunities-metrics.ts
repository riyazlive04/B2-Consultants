import "server-only";

import { prisma } from "@/lib/prisma";
import { formatInrMinor } from "@/lib/format";
import { resolveBant } from "@/lib/bant-view";

/**
 * Read layer for the Opportunities Kanban board (Synamate "Pipelines").
 * Returns display-ready, serializable data (money pre-formatted, no BigInt).
 */

// A pipeline with more cards in one stage than this is rare (and previously this query had no
// cap at all - fetched every open/won/lost deal, every load). Cap + signal overflow rather than
// silently truncate: BUILD_CHECKLIST.md §4.
const STAGE_CARD_LIMIT = 300;

export type BoardCard = {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  /** Drives the card's call / WhatsApp actions. Null hides them rather than rendering dead icons. */
  contactPhone: string | null;
  source: string | null;
  valueInr: string;
  ownerName: string | null;
  ownerId: string | null;
  status: string;
  position: number;
  stageId: string;
  /** Notes already on this card, for the badge. 0 renders no badge. */
  noteCount: number;
  /**
   * Speed-to-lead inputs (ISO strings - BoardData crosses the server/client boundary).
   * `optInAt` is the journey's clock when the lead has one, else the lead's creation; `firstCallAt`
   * is the earliest logged call of ANY outcome. The verdict is computed client-side so the DUE
   * countdown can tick without a round trip - see lib/speed-to-lead.firstCallVerdict.
   */
  optInAt: string;
  firstCallAt: string | null;
  /**
   * The band score to show once the prospect has a call booked, 0-5, or null when nobody has
   * scored them.
   *
   * Resolved server-side through `resolveBant` - the one rule for "which stored score do I show"
   * - so this card can never disagree with the desk or the bookings table about the same person.
   * Null is "not scored", never zero: an unscored prospect is one nobody has asked, and drawing
   * them as 0.0 alongside genuinely poor ones is how a good lead gets buried.
   */
  bantAvg: number | null;
  /**
   * Who the discovery call is actually booked with, once one is booked.
   *
   * NOT the lead's assignee: those are two different people doing two different jobs. The
   * assignee is whoever chased the opt-in; this is whose diary the call sits in, and from the
   * booked column onwards that is the fact the board is being read for.
   */
  bookedWithName: string | null;
  /**
   * Their profile photo, when they have uploaded one at /profile.
   *
   * Carried because initials do not survive this team: "Ameen" and "Asma" both reduce to a
   * single "A", so a card showing initials alone cannot say which of them the call is with -
   * which is the entire question the avatar is there to answer.
   */
  bookedWithImage: string | null;
};

export type BoardStage = {
  id: string;
  name: string;
  legacyStage: string | null;
  /** Only set on a WON column: which of Synamate's two won columns this is (Split Pay / Full pay). */
  paymentPlan: string | null;
  probability: number | null;
  count: number;
  totalInr: string;
  // Only set when this stage has a probability configured - the flat totalInr stays the primary,
  // always-correct figure; this is an additional weighted-forecast read, never a replacement.
  weightedTotalInr: string | null;
  cards: BoardCard[];
  hasMore: boolean;
};

export type BoardData = {
  pipelines: { id: string; name: string; isDefault: boolean }[];
  activePipelineId: string | null;
  activePipelineName: string | null;
  stages: BoardStage[];
  owners: { id: string; name: string }[];
  totalCount: number;
  totalValueInr: string;
  // Only set when at least one stage in the active pipeline has a probability configured.
  weightedTotalValueInr: string | null;
  /** True when any filter is narrowing the board - the UI says so, and offers to clear it. */
  filtered: boolean;
};

/**
 * What may narrow the board.
 *
 * The board had NO filter of any kind, while simultaneously telling the user at 300+ cards in a
 * stage to "filter or split this pipeline" - advice for a control that did not exist. That was
 * survivable only because production held ONE opportunity; wiring lead capture to the board
 * (`ensureDefaultOpportunity`) puts thousands of cards on it, so search stopped being optional.
 *
 * Applied in SQL, not in the browser. Filtering client-side would filter the already-capped
 * 300-card slice, so a search for a contact sitting at position 400 would return nothing and
 * look like "no such deal" rather than "not on this page".
 */
export type BoardFilters = {
  /** Matches the deal name, and the contact's name / phone / email. */
  search?: string;
  ownerId?: string;
  /** OPEN | WON | LOST | ABANDONED. */
  status?: string;
};

export type PipelineRow = {
  id: string;
  name: string;
  isDefault: boolean;
  stageCount: number;
  oppCount: number;
  updatedAt: Date;
};

/**
 * The Pipelines management list.
 *
 * `stageCount` counts LIVE columns only - a soft-deleted stage is gone as far as anyone reading
 * this screen is concerned, and counting it would make the number disagree with the board.
 * Ordered the same way the board's switcher orders, so the two screens never contradict.
 */
export async function listPipelines(): Promise<PipelineRow[]> {
  const rows = await prisma.pipeline.findMany({
    where: { deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
      updatedAt: true,
      _count: { select: { stages: { where: { deletedAt: null } }, opps: { where: { deletedAt: null } } } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stageCount: p._count.stages,
    oppCount: p._count.opps,
    updatedAt: p.updatedAt,
  }));
}

export async function getBoard(pipelineId?: string, filters: BoardFilters = {}): Promise<BoardData> {
  const search = filters.search?.trim();
  const ownerId = filters.ownerId?.trim();
  const status = filters.status?.trim();
  const filtered = Boolean(search || ownerId || status);

  /**
   * The card-level predicate, shared by the display query AND the totals groupBy below.
   *
   * They MUST share it: totals computed over an unfiltered set beside a filtered card list is
   * the classic "the header says ₹40L, I can see two deals" bug.
   */
  const cardWhere = {
    deletedAt: null,
    lead: { deletedAt: null },
    ...(ownerId ? { assignedToId: ownerId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { lead: { deletedAt: null, name: { contains: search, mode: "insensitive" as const } } },
            { lead: { deletedAt: null, phone: { contains: search } } },
            { lead: { deletedAt: null, email: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  const pipelines = await prisma.pipeline.findMany({
    where: { deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true },
  });

  const active = pipelineId
    ? pipelines.find((p) => p.id === pipelineId) ?? pipelines[0]
    : pipelines[0];

  const owners = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (!active) {
    return {
      pipelines,
      activePipelineId: null,
      activePipelineName: null,
      stages: [],
      owners,
      totalCount: 0,
      totalValueInr: formatInrMinor(0n),
      weightedTotalValueInr: null,
      filtered,
    };
  }

  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: active.id, deletedAt: null },
    orderBy: { position: "asc" },
    include: {
      opps: {
        // Exclude archived opportunities and deals whose parent contact is archived, then apply
        // the caller's filters - same predicate the totals below use.
        where: cardWhere,
        orderBy: { position: "asc" },
        take: STAGE_CARD_LIMIT + 1, // fetch one extra to detect overflow without a second COUNT query
        include: {
          // The lead's owner is the fallback for a card that was created without one (the native
          // form path until 19/08/2026, or any card made before the lead was assigned).
          lead: {
            select: {
              id: true, name: true, phone: true, createdAt: true,
              // The landing page's score, and the booking form's fuller one - `resolveBant`
              // picks between them. Both are plain columns on rows already being read.
              bantAvg: true, bantScore: true, bantVerdict: true, bantSource: true,
              bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
              bookings: {
                where: { status: { not: "CANCELLED" } },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  bantAvg: true, bantScore: true, bantVerdict: true,
                  bantBudget: true, bantAuthority: true, bantNeed: true, bantTimeline: true,
                  // Whose calendar the call landed in - the slot's owner, not the lead's.
                  slot: { select: { assignedTo: { select: { name: true, image: true } } } },
                },
              },
              assignedTo: { select: { id: true, name: true } },
              outreachJourney: { select: { optInAt: true } },
            },
          },
          assignedTo: { select: { id: true, name: true } },
          // Counted here rather than in a second pass: Prisma resolves it as one grouped subquery
          // over the same rows already being fetched, so the badge costs no extra round trip.
          _count: { select: { notes: true } },
        },
      },
    },
  });

  // Stage/grand/forecast totals are computed over ALL opportunities in each stage (a groupBy), not
  // just the display-capped `opps` slice above - otherwise a stage with more than STAGE_CARD_LIMIT
  // cards would under-report its value. They are also split by status so WON/LOST/ABANDONED deals
  // no longer inflate the live pipeline value or the weighted forecast: "pipeline value" means
  // money still IN PLAY (issue 1.6). Each column header still shows that column's own full sum
  // (all statuses) - which is what someone reading a Won/Lost column expects.
  const sums = await prisma.opportunity.groupBy({
    by: ["stageId", "status"],
    where: { stageId: { in: stages.map((s) => s.id) }, ...cardWhere },
    _sum: { valueInrMinor: true },
    // The TRUE card count, from the same set as the money. The header used to report
    // `cards.length` - the display slice - so a column holding more than STAGE_CARD_LIMIT would
    // announce "300 opportunities" beside a total covering thousands. Harmless while production
    // had one card; wrong the moment lead capture fills the board.
    _count: { _all: true },
  });
  const allByStage = new Map<string, bigint>();
  const openByStage = new Map<string, bigint>();
  const countByStage = new Map<string, number>();
  for (const r of sums) {
    const v = r._sum.valueInrMinor ?? 0n;
    allByStage.set(r.stageId, (allByStage.get(r.stageId) ?? 0n) + v);
    countByStage.set(r.stageId, (countByStage.get(r.stageId) ?? 0) + r._count._all);
    if (r.status === "OPEN") openByStage.set(r.stageId, (openByStage.get(r.stageId) ?? 0n) + v);
  }

  // First call per lead, in ONE grouped query across every card on the board rather than a
  // per-card subquery (up to 300 cards x N columns). Any outcome counts - the speed-to-lead
  // question on the board is "did someone pick up the phone in five minutes", not "did they
  // get through", which is what `contactedAt` / the desk's SPOKE rule measure.
  const leadIds = [...new Set(stages.flatMap((s) => s.opps.slice(0, STAGE_CARD_LIMIT).map((o) => o.lead.id)))];
  const firstCalls = leadIds.length
    ? await prisma.callLog.groupBy({ by: ["leadId"], where: { leadId: { in: leadIds } }, _min: { calledAt: true } })
    : [];
  const firstCallByLead = new Map(firstCalls.map((r) => [r.leadId, r._min.calledAt]));

  let totalCount = 0;
  let grandTotal = 0n; // OPEN only - the live pipeline value
  let weightedGrandTotal = 0n; // OPEN only, probability-weighted
  let anyWeighted = false;

  const boardStages: BoardStage[] = stages.map((s) => {
    const hasMore = s.opps.length > STAGE_CARD_LIMIT;
    const oppsForDisplay = hasMore ? s.opps.slice(0, STAGE_CARD_LIMIT) : s.opps;

    const cards: BoardCard[] = oppsForDisplay.map((o) => ({
      id: o.id,
      name: o.name,
      contactId: o.lead.id,
      contactName: o.lead.name,
      contactPhone: o.lead.phone,
      source: o.source,
      valueInr: formatInrMinor(o.valueInrMinor),
      ownerName: o.assignedTo?.name ?? o.lead.assignedTo?.name ?? null,
      ownerId: o.assignedTo?.id ?? o.lead.assignedTo?.id ?? null,
      status: o.status,
      position: o.position,
      stageId: o.stageId,
      noteCount: o._count.notes,
      optInAt: (o.lead.outreachJourney?.optInAt ?? o.lead.createdAt).toISOString(),
      firstCallAt: firstCallByLead.get(o.lead.id)?.toISOString() ?? null,
      bantAvg: resolveBant(o.lead.bookings[0] ?? null, o.lead)?.avg ?? null,
      bookedWithName: o.lead.bookings[0]?.slot?.assignedTo?.name ?? null,
      bookedWithImage: o.lead.bookings[0]?.slot?.assignedTo?.image ?? null,
    }));

    const stageAll = allByStage.get(s.id) ?? 0n; // column header: every card, any status
    const stageOpen = openByStage.get(s.id) ?? 0n; // live pipeline: OPEN cards only
    const stageCount = countByStage.get(s.id) ?? 0; // every card, not just the rendered slice

    totalCount += stageCount;
    grandTotal += stageOpen;

    const weightedOpen =
      s.probability != null ? (stageOpen * BigInt(s.probability)) / 100n : stageOpen;
    weightedGrandTotal += weightedOpen;
    if (s.probability != null) anyWeighted = true;

    return {
      id: s.id,
      name: s.name,
      legacyStage: s.legacyStage,
      paymentPlan: s.paymentPlan,
      probability: s.probability,
      count: stageCount,
      totalInr: formatInrMinor(stageAll),
      weightedTotalInr: s.probability != null ? formatInrMinor(weightedOpen) : null,
      cards,
      hasMore,
    };
  });

  return {
    pipelines,
    activePipelineId: active.id,
    activePipelineName: active.name,
    stages: boardStages,
    owners,
    totalCount,
    totalValueInr: formatInrMinor(grandTotal),
    weightedTotalValueInr: anyWeighted ? formatInrMinor(weightedGrandTotal) : null,
    filtered,
  };
}
